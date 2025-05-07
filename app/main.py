from flask import Flask, render_template, request, jsonify, redirect, Blueprint 
import json
from google.cloud.sql.connector import Connector
import sqlalchemy
from sqlalchemy import text, bindparam
import os
from datetime import datetime, timedelta
import pg8000
from dotenv import load_dotenv
from flask import request, jsonify
from firebase_admin import auth, credentials, initialize_app
import firebase_admin
from functools import wraps 
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask import session
import traceback
import base64
from email.mime.text import MIMEText
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
import functions_framework
import stripe


# Initialize Firebase Admin SDK (only once)
if not firebase_admin._apps:
    cred = credentials.Certificate("firebase.json")
    initialize_app(cred)

load_dotenv('.env')

# Set credentials for Google Cloud SQL
credential_path = "cloud.json"
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credential_path

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'default_dev_key')
# Database configuration
INSTANCE_CONNECTION_NAME = os.environ["INSTANCE_CONNECTION_NAME"]
DB_USER = os.environ["DB_USER"]
DB_PASS = os.environ["DB_PASS"]
DB_NAME = os.environ["DB_NAME"]

# Initialize the connector
connector = Connector()

def get_connection():
    return connector.connect(
        INSTANCE_CONNECTION_NAME,
        "pg8000",
        user=DB_USER,
        password=DB_PASS,
        db=DB_NAME
    )

# Create connection pool
pool = sqlalchemy.create_engine(
    "postgresql+pg8000://",
    creator=get_connection,
    pool_size=5,
    max_overflow=2,
    pool_timeout=30,
    pool_recycle=1800
)

admin_routes = Blueprint('admin_routes', __name__)

# Set up Stripe API key 
stripe.api_key = os.environ.get('STRIPE_API_KEY')

# Gmail API setup
SCOPES = ['https://www.googleapis.com/auth/gmail.send']
CREDENTIALS_FILE = 'credentials.json'  # Keep your original credentials file
load_dotenv('.env.gmail')  # Load Gmail credentials from .env file
# Instead of writing to a file, we'll store the token in an environment variable
gmail_service = None

def get_gmail_service():
    global gmail_service
    if gmail_service:
        return gmail_service
    
    creds = None
    
    # Try to get token from environment variable instead of file
    if 'GMAIL_TOKEN' in os.environ:
        try:
            token_info = json.loads(os.environ['GMAIL_TOKEN'])
            creds = Credentials.from_authorized_user_info(token_info, SCOPES)
            print("Loaded credentials from environment variable.")
        except Exception as e:
            print(f"Error loading credentials from environment: {e}")
            creds = None
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                print("Access token refreshed.")
                # Update environment variable instead of writing to file
                os.environ['GMAIL_TOKEN'] = json.dumps(creds.to_json())
            except Exception as e:
                print(f"Failed to refresh token: {e}")
                creds = None
        
        if not creds:
            # Original flow using credentials.json
            if not os.path.exists(CREDENTIALS_FILE):
                print(f"Missing credentials file: {CREDENTIALS_FILE}")
                return None
            
            try:
                # Try using a different port to avoid conflicts
                flow = InstalledAppFlow.from_client_secrets_file(
                    CREDENTIALS_FILE, SCOPES)
                creds = flow.run_local_server(
                    port=0,  # Use any available port
                    access_type='offline',
                    prompt='consent')
                
                # Instead of writing to file, print token to be set as env var
                token_json = creds.to_json()
                print("New credentials obtained.")
                print("Set this as your GMAIL_TOKEN environment variable:")
                print(token_json)
                
                # Also set it in current environment
                os.environ['GMAIL_TOKEN'] = token_json
            except Exception as e:
                print(f"Error during authentication: {e}")
                return None
    
    try:
        gmail_service = build('gmail', 'v1', credentials=creds)
        return gmail_service
    except Exception as e:
        print(f"Error building Gmail service: {e}")
        return None


def require_admin(pool):
    """
    Decorator to ensure the request comes from an admin user.
    Looks for a Firebase ID token stored in a cookie (e.g. 'firebaseToken' or 'token').
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            # Try to get the token from cookies instead of the Authorization header
            token = request.cookies.get('firebaseToken') or request.cookies.get('token')
            if not token:
                print("Authorization Error: No token found in cookies")
                return jsonify({'error': 'Unauthorized - Token missing in cookies'}), 401

            try:
                # Verify Firebase ID token
                decoded_token = auth.verify_id_token(token)
                user_email = decoded_token.get('email')

                if not user_email:
                    print(f"Authorization Error: Email missing in token payload (UID: {decoded_token.get('uid')})")
                    return jsonify({'error': 'Unauthorized - Email missing in token'}), 401

                with pool.connect() as conn:
                    query = sqlalchemy.text("SELECT 1 FROM public.admin WHERE email = :email")
                    result = conn.execute(query, {"email": user_email}).fetchone()
                    is_admin = result is not None

                if not is_admin:
                    print(f"Access Denied: '{user_email}' is not in public.admin")
                    return jsonify({'error': 'Forbidden - Not an administrator'}), 403

                print(f"Access Granted: '{user_email}' accessed {f.__name__}")
                return f(*args, **kwargs)

            except auth.ExpiredIdTokenError:
                print("Token expired")
                return jsonify({'error': 'Unauthorized - Token expired'}), 401
            except auth.InvalidIdTokenError as e:
                print(f"Invalid token: {e}")
                return jsonify({'error': 'Unauthorized - Invalid token'}), 401
            except Exception as e:
                print("Unexpected error in require_admin:")
                traceback.print_exc()
                return jsonify({'error': 'Internal server error'}), 500

        return wrapper
    return decorator

def require_authentication(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        # Extract token from headers or cookies
        token = request.cookies.get('firebaseToken') or request.cookies.get('token')
        print(token)
        if not token:
            return jsonify({'error': 'Unauthorized - Token missing'}), 401
        
        try:
            # Verify Firebase token
            decoded_token = auth.verify_id_token(token)
            request.user_email = decoded_token.get('email')  # You can store user info in the request object
            return f(*args, **kwargs)
        except auth.InvalidIdTokenError:
            return jsonify({'error': 'Unauthorized - Invalid token'}), 401
        except auth.ExpiredIdTokenError:
            return jsonify({'error': 'Unauthorized - Token expired'}), 401
        except Exception as e:
            return jsonify({'error': 'Unauthorized - Internal error'}), 500
    
    return wrapper


@app.route('/check-admin', methods=['POST'])
def check_admin():
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Invalid authorization header - No token provided'}), 401

    token = auth_header.split('Bearer ')[1]

    try:
        # Verify the token first
        decoded_token = auth.verify_id_token(token)
        user_email = decoded_token.get('email') # Use email from the verified token

        if not user_email:
            return jsonify({'error': 'Unauthorized - Email missing in token'}), 401

        print(f"--- /check-admin (token verified) ---")
        print(f"Checking admin status for email from token: {user_email}")

        with pool.connect() as conn:
            query = sqlalchemy.text("SELECT 1 FROM public.admin WHERE email = :email")
            result = conn.execute(query, {"email": user_email}).fetchone()
            is_admin = result is not None
            print(f"Querying public.admin for '{user_email}', found: {is_admin}")
        session['firebase_uid'] = decoded_token['uid']
        session['is_admin'] = is_admin
        return jsonify({'isAdmin': is_admin})
    except auth.InvalidIdTokenError:
         return jsonify({'error': 'Unauthorized - Invalid token'}), 401
    except auth.ExpiredIdTokenError:
         return jsonify({'error': 'Unauthorized - Token expired'}), 401
    except Exception as e:
        import traceback
        print("Exception occurred in /check-admin:", e)
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/check-user', methods=['POST'])
def check_user():
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid Authorization header'}), 401

    token = auth_header.split('Bearer ')[1]

    try:
        decoded_token = auth.verify_id_token(token)
        firebase_uid = decoded_token.get('uid')
        email = decoded_token.get('email')

        if not email or not firebase_uid:
            return jsonify({'error': 'Invalid token: missing email or uid'}), 400

        print(f"--- /check-user ---\nUser email: {email}, UID: {firebase_uid}")

        with pool.connect() as conn:
            # Check if user is admin
            admin_check = conn.execute(
                sqlalchemy.text("SELECT 1 FROM public.admin WHERE email = :email"),
                {"email": email}
            ).fetchone()
            is_admin = admin_check is not None

            if is_admin:
                return jsonify({'message': 'Admin user - no action taken', 'isAdmin': True}), 200

            # Check if user already exists in renter table
            renter_check = conn.execute(
                sqlalchemy.text("SELECT renter_id FROM public.renter WHERE firebase_uid = :uid OR renter_email = :email"),
                {"uid": firebase_uid, "email": email}
            ).fetchone()

            if renter_check:
                return jsonify({'message': 'User already exists in renter table'}), 200

            # Insert minimal info for new user
            insert_query = sqlalchemy.text("""
                INSERT INTO public.renter (first_name, last_name, renter_email, firebase_uid, created_at)
                VALUES ('missing', 'missing', :email, :uid, NOW())
                RETURNING renter_id
            """)
            result = conn.execute(insert_query, {"email": email, "uid": firebase_uid})
            renter_id = result.fetchone()[0]

            return jsonify({
                'message': 'New renter created with minimal info',
                'renter_id': renter_id
            }), 201
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@functions_framework.http
def cleanup_requests(request):
    try:
        with pool.connect() as conn:
            delete_query = sqlalchemy.text("""
                DELETE FROM public.rental_request
                WHERE end_date < (NOW() - INTERVAL '4 months')
                RETURNING request_id, renter_id, end_date
            """)
            result = conn.execute(delete_query)
            deleted = result.fetchall()

            return jsonify({
                "message": f"Deleted {len(deleted)} rental request(s)",
                "deleted_requests": [
                    {"request_id": row[0], "renter_id": row[1], "end_date": row[2].isoformat()}
                    for row in deleted
                ]
            })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@functions_framework.http
@app.route('/cleanup-renters', methods=['POST'])
def cleanup_renters():
    try:
        with pool.connect() as conn:
            # Delete renters older than 1 month with no related rental requests
            delete_query = sqlalchemy.text("""
                DELETE FROM public.renter
                WHERE created_at < (NOW() - INTERVAL '1 month')
                AND renter_id NOT IN (
                    SELECT DISTINCT renter_id FROM public.rental_request
                )
                RETURNING renter_id, renter_email
            """)
            result = conn.execute(delete_query)
            deleted = result.fetchall()

            return jsonify({
                "message": f"Deleted {len(deleted)} renter(s)",
                "deleted_renters": [{"renter_id": row[0], "email": row[1]} for row in deleted]
            })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

def get_user_uid():
    if session.get('is_admin'):
        return None 
    if 'firebase_uid' in session:
        return f"user:{session['firebase_uid']}"
    return get_remote_address()


# Initialize the limiter with the custom key function
limiter = Limiter(
    key_func=get_user_uid,
    app=app,
    default_limits=[]  # we'll add per-route limits
)

@app.route('/logout')
def logout():
    session.clear() 
    response = redirect('/')
    response.set_cookie('firebaseToken', '', expires=0, path='/', secure=True, httponly=True, samesite='Strict')
    return response


@app.route('/')
def home():
    return render_template('homepage.html')

@app.route('/u')
@require_authentication
def u():
    return render_template('userrequest.html')

@app.route("/admin")
@require_admin(pool)
def admin():
    return render_template("admin.html")

@app.route('/signup')
def signup():
    return render_template('signup.html')

@app.route("/resetpassword")
def reset_password():
    return render_template("resetpassword.html")

@app.route('/api/register', methods=['POST'])
@limiter.limit("100 per month")
def register_user():
    """Securely register a new user after verifying Firebase ID token"""
    try:
        # Verify Firebase ID token
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401

        id_token = auth_header.split("Bearer ")[1]
        decoded_token = auth.verify_id_token(id_token)
        firebase_uid = decoded_token['uid']
        email = decoded_token['email']

        # Get form data
        data = request.get_json()
        required_fields = ['first_name', 'last_name', 'phone']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400

        # Prevent duplicate accounts
        with pool.connect() as conn:
            check_query = sqlalchemy.text("""
                SELECT renter_id FROM public.renter 
                WHERE renter_email = :email OR firebase_uid = :uid
            """)
            existing_user = conn.execute(check_query, {"email": email, "uid": firebase_uid}).fetchone()

            if existing_user:
                return jsonify({"error": "User already exists"}), 409

            # Insert new verified user
            insert_query = sqlalchemy.text("""
                INSERT INTO public.renter 
                (first_name, last_name, renter_email, phone, firebase_uid, created_at)
                VALUES 
                (:first_name, :last_name, :email, :phone, :uid, NOW())
                RETURNING renter_id
            """)
            result = conn.execute(
                insert_query,
                {
                    "first_name": data['first_name'],
                    "last_name": data['last_name'],
                    "email": email,
                    "phone": data['phone'],
                    "uid": firebase_uid
                }
            )
            

            return jsonify({
                "message": "User registered successfully",
                "renter_id": result.fetchone()[0]
            })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500




@app.route('/api/user_profile/<firebase_uid>')
@require_authentication
def get_user_profile(firebase_uid):
    """Get user profile information from the renter table"""
    try:
        with pool.connect() as conn:
            # Query the renter table
            profile_query = sqlalchemy.text("""
                SELECT first_name, last_name, phone, renter_email
                FROM public.renter 
                WHERE firebase_uid = :firebase_uid
            """)
            
            profile = conn.execute(
                profile_query,
                {"firebase_uid": firebase_uid}
            ).mappings().first()
            
            if not profile:
                return jsonify({"error": "User profile not found"}), 404
                
            return jsonify({
                "first_name": profile['first_name'],
                "last_name": profile['last_name'],
                "phone": profile['phone'],
                "email": profile['renter_email']
            })
            
    except Exception as e:
        print("Error fetching user profile:", str(e))
        return jsonify({"error": str(e)}), 500

@app.route('/api/admin/search-users')
@require_admin(pool)
def search_users():
    """Search users by name or email for admin user search feature"""
    try:
        query = request.args.get('query', '')
        if not query or len(query) < 2:
            return jsonify({
                "users": [],
                "success": True
            })
        
        with pool.connect() as conn:
            # Convert RowMapping to dictionary for JSON serialization
            def row_to_dict(row):
                return {key: value for key, value in row._mapping.items()}
            
            # Search users by first name, last name, or email
            search_query = sqlalchemy.text("""
                SELECT 
                    renter_id as user_id,
                    CONCAT(first_name, ' ', last_name) as full_name,
                    renter_email as email,
                    phone
                FROM public.renter
                WHERE 
                    first_name ILIKE :search_term OR
                    last_name ILIKE :search_term OR
                    renter_email ILIKE :search_term OR
                    CONCAT(first_name, ' ', last_name) ILIKE :search_term
                ORDER BY first_name, last_name
                LIMIT 10
            """)
            
            # Use % for partial matching
            search_param = f"%{query}%"
            users = [row_to_dict(row) for row in conn.execute(search_query, {"search_term": search_param})]
            
            return jsonify({
                "users": users,
                "success": True
            })
            
    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error searching users: {str(e)}")
        return jsonify({
            "error": "Database error occurred",
            "success": False
        }), 500
    except Exception as e:
        print(f"Unexpected error searching users: {str(e)}")
        return jsonify({
            "error": "An unexpected error occurred",
            "success": False
        }), 500



@app.route('/api/admin/all-users')
@require_admin(pool)
def admin_get_all_users():
    """Get all users for admin dropdown"""
    try:
        with pool.connect() as conn:
            # Convert RowMapping to dictionary for JSON serialization
            def row_to_dict(row):
                return {key: value for key, value in row._mapping.items()}
            
            query = sqlalchemy.text("""
                SELECT 
                    renter_id as user_id,
                    CONCAT(first_name, ' ', last_name) as full_name,
                    renter_email as email,
                    phone
                FROM public.renter
                ORDER BY last_name, first_name
            """)
            
            users = [row_to_dict(row) for row in conn.execute(query)]
            
            return jsonify({
                "users": users,
                "count": len(users),
                "success": True
            })
            
    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error fetching all users: {str(e)}")
        return jsonify({
            "error": "Database error occurred",
            "success": False
        }), 500
    except Exception as e:
        print(f"Unexpected error fetching all users: {str(e)}")
        return jsonify({
            "error": "An unexpected error occurred",
            "success": False
        }), 500

@app.route('/api/admin/all-requests')
@require_admin(pool)
def admin_get_all_requests():
    """Get all rental requests for admin view"""
    try:
        with pool.connect() as conn:
            # Convert RowMapping to dictionary for JSON serialization
            def row_to_dict(row):
                return {key: value for key, value in row._mapping.items()}
            
            # Base query for all requests
            query = sqlalchemy.text("""
                SELECT 
                    rr.request_id, 
                    rr.rental_name, 
                    rr.additional_desc, 
                    TO_CHAR(rr.start_date, 'YYYY-MM-DD') as start_date,
                    TO_CHAR(rr.end_date, 'YYYY-MM-DD') as end_date,
                    TO_CHAR(rr.start_time, 'HH12:MI AM') as start_time,
                    TO_CHAR(rr.end_time, 'HH12:MI AM') as end_time,
                    rr.is_recurring, 
                    rr.recurrence_rule,
                    rr.request_date,
                    CASE 
                        WHEN rr.rental_status = 'pending' THEN 'pending'
                        WHEN rr.rental_status = 'approved' THEN 'approved'
                        WHEN rr.rental_status = 'denied' THEN 'declined'
                        ELSE rr.rental_status
                    END as request_status,
                    rr.amount,
                    rr.paid,
                    rr.declined_reason,
                    r.renter_id as user_id,
                    r.renter_email as user_email,
                    CONCAT(r.first_name, ' ', r.last_name) as user_name,
                    r.phone as user_phone,
                    EXTRACT(MONTH FROM rr.start_date) as month,
                    EXTRACT(YEAR FROM rr.start_date) as year
                FROM public.rental_request rr
                JOIN public.renter r ON rr.user_id = r.renter_id
                ORDER BY rr.start_date DESC, rr.start_time
            """)
            
            requests = [row_to_dict(row) for row in conn.execute(query)]
            
            # Calculate payment summaries
            paid_total = sum(float(request['amount'] or 0) for request in requests if request['paid'])
            unpaid_total = sum(float(request['amount'] or 0) for request in requests 
                          if not request['paid'] and request['amount'] and request['request_status'] == 'approved')
            all_total = sum(float(request['amount'] or 0) for request in requests if request['amount'])
            
            return jsonify({
                "requests": requests,
                "count": len(requests),
                "payment_summary": {
                    "paid": paid_total,
                    "unpaid": unpaid_total,
                    "total": all_total
                },
                "success": True
            })
            
    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error fetching all requests: {str(e)}")
        return jsonify({
            "error": "Database error occurred",
            "success": False
        }), 500
    except Exception as e:
        print(f"Unexpected error fetching all requests: {str(e)}")
        return jsonify({
            "error": "An unexpected error occurred",
            "success": False
        }), 500

@app.route('/api/admin/update-request/<int:request_id>', methods=['POST'])
@require_admin(pool)
def update_request_status(request_id):
    """Update the status of a rental request"""
    try:
        data = request.get_json()
        status = data.get('status')
        reason = data.get('reason')
        
        if status not in ['approved', 'denied','admin']:
            return jsonify({'error': 'Invalid status', 'success': False}), 400
            
        with pool.connect() as conn:
            # Update the request status
            update_query = sqlalchemy.text("""
                UPDATE public.rental_request
                SET rental_status = :status,
                    declined_reason = CASE WHEN :status = 'denied' THEN :reason ELSE NULL END
                WHERE request_id = :request_id
                RETURNING request_id
            """)
            
            result = conn.execute(
                update_query,
                {
                    "status": status,
                    "reason": reason,
                    "request_id": request_id
                }
            )
            
            
            if result.rowcount == 0:
                return jsonify({'error': 'Request not found', 'success': False}), 404
                
            return jsonify({
                'success': True,
                'reason': reason if status == 'denied' else None
            })
            
    except Exception as e:
        print(f"Error updating request status: {str(e)}")
        return jsonify({'error': str(e), 'success': False}), 500

@app.route('/api/admin/mark-paid/<int:request_id>', methods=['POST'])
@require_admin(pool)
def mark_request_paid(request_id):
    """Mark a rental request as paid"""
    try:
        with pool.connect() as conn:
            # Update the paid status
            update_query = sqlalchemy.text("""
                UPDATE public.rental_request
                SET paid = true
                WHERE request_id = :request_id
                RETURNING request_id
            """)
            
            result = conn.execute(
                update_query,
                {
                    "request_id": request_id
                }
            )
            
            
            if result.rowcount == 0:
                return jsonify({'error': 'Request not found', 'success': False}), 404
                
            return jsonify({'success': True})
            
    except Exception as e:
        print(f"Error marking request as paid: {str(e)}")
        return jsonify({'error': str(e), 'success': False}), 500

@app.route('/user_search')
@require_admin(pool)
def user_search():
    """Render the user search page"""
    return render_template('user_search.html')

@app.route('/api/user_events/<firebase_uid>')
@require_authentication
def get_user_events(firebase_uid):
    """API endpoint to fetch pending and approved events specific to a user"""
    try:
        # Validate the requesting user matches the requested UID
        if session.get('firebase_uid') != firebase_uid and not session.get('is_admin'):
            return {"error": "Unauthorized access"}, 403
            
        # Calculate date range (1 year back and 6 months forward)
        today = datetime.now().date()
        start_date = today - timedelta(days=365)
        end_date = today + timedelta(days=180)
        
        with pool.connect() as conn:
            # Query rental requests for the specific user - only pending and approved
            rental_query = sqlalchemy.text("""
                SELECT 
                    request_id as id,
                    rental_name as name,
                    additional_desc as description,
                    start_time::text as start_time,
                    end_time::text as end_time,
                    start_date::text as start_date,
                    end_date::text as end_date,
                    rental_status as status,
                    is_recurring,
                    recurrence_rule
                FROM public.rental_request
                INNER JOIN public.renter ON public.rental_request.user_id = renter.renter_id
                WHERE renter.firebase_uid = :firebase_uid
                AND rental_status IN ('pending', 'approved','admin')
                AND (
                    (is_recurring = false AND start_date BETWEEN :start AND :end)
                    OR 
                    (is_recurring = true AND end_date >= :start)
                )
            """)
            
            rentals = conn.execute(
                rental_query, 
                {"firebase_uid": firebase_uid, "start": start_date, "end": end_date}
            ).mappings().all()
            
            # Process recurring events
            all_events = process_recurring_events(
                rentals,
                start_date,
                end_date
            )
            
            return {"events": all_events}
            
    except Exception as e:
        print(f"Error fetching user events: {str(e)}")
        return {"error": str(e)}, 500

@app.route('/api/check_conflicts', methods=['POST'])
@require_authentication
def check_conflicts():
    try:
        data = request.get_json()
        print("Received conflict check data:", data)
        
        # Validate required fields
        required_fields = ['start_date', 'end_date', 'start_time', 'end_time']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400

        # Convert strings to date and time objects
        proposed_start_date = datetime.strptime(data['start_date'], '%m/%d/%Y').date()
        proposed_end_date = datetime.strptime(data['end_date'], '%m/%d/%Y').date()
        proposed_start_time = datetime.strptime(data['start_time'], '%I:%M %p').time()
        proposed_end_time = datetime.strptime(data['end_time'], '%I:%M %p').time()

        proposed_is_recurring = data.get('is_recurring', False)
        proposed_recurrence_rule = data.get('recurrence_rule')

        with pool.connect() as conn:
            rental_query = sqlalchemy.text("""
                SELECT 
                    request_id, 
                    rental_name, 
                    start_date, 
                    end_date, 
                    start_time, 
                    end_time, 
                    is_recurring,
                    recurrence_rule,
                    rental_status
                FROM public.rental_request
                WHERE 
                    rental_status IN ('approved', 'admin')
            """)
            rental_results = conn.execute(rental_query).fetchall()

            admin_query = sqlalchemy.text("""
                SELECT 
                    event_id, 
                    event_name, 
                    start_date, 
                    end_date, 
                    start_time, 
                    end_time,
                    is_recurring,
                    recurrence_rule
                FROM public.admin_event
            """)
            admin_results = conn.execute(admin_query).fetchall()

            rental_conflicts_list = []
            admin_conflicts_list = []

            def times_overlap(t1_start, t1_end, t2_start, t2_end):
                return t1_start <= t2_end and t1_end >= t2_start

            def days_of_week_match(d1, d2):
                return d1.weekday() == d2.weekday()

            for rental in rental_results:
                rental_id, rental_name, rental_start_date, rental_end_date, rental_start_time, rental_end_time, rental_is_recurring, rental_recurrence_rule, rental_status = rental
                has_conflict = False

                if not proposed_is_recurring and not rental_is_recurring:
                    dates_overlap = proposed_start_date <= rental_end_date and proposed_end_date >= rental_start_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, rental_start_time, rental_end_time)
                    has_conflict = dates_overlap and time_overlap

                elif not proposed_is_recurring and rental_is_recurring:
                    in_range = rental_start_date <= proposed_start_date <= rental_end_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, rental_start_time, rental_end_time)
                    day_matches = rental_recurrence_rule != 'weekly' or days_of_week_match(proposed_start_date, rental_start_date)
                    has_conflict = in_range and time_overlap and day_matches

                elif proposed_is_recurring and not rental_is_recurring:
                    in_range = proposed_start_date <= rental_start_date <= proposed_end_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, rental_start_time, rental_end_time)
                    day_matches = proposed_recurrence_rule != 'weekly' or days_of_week_match(rental_start_date, proposed_start_date)
                    has_conflict = in_range and time_overlap and day_matches

                elif proposed_is_recurring and rental_is_recurring:
                    dates_overlap = proposed_start_date <= rental_end_date and proposed_end_date >= rental_start_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, rental_start_time, rental_end_time)

                    if proposed_recurrence_rule == 'daily' or rental_recurrence_rule == 'daily':
                        pattern_conflict = True
                    elif proposed_recurrence_rule == 'weekly' and rental_recurrence_rule == 'weekly':
                        pattern_conflict = days_of_week_match(proposed_start_date, rental_start_date)
                    else:
                        pattern_conflict = True

                    has_conflict = dates_overlap and time_overlap and pattern_conflict

                if has_conflict:
                    rental_conflicts_list.append({
                        "request_id": rental_id,
                        "rental_name": rental_name,
                        "start_date": rental_start_date.isoformat(),
                        "end_date": rental_end_date.isoformat(),
                        "start_time": str(rental_start_time),
                        "end_time": str(rental_end_time),
                        "is_recurring": rental_is_recurring,
                        "recurrence_rule": rental_recurrence_rule,
                        "rental_status": rental_status
                    })

            for admin in admin_results:
                event_id, event_name, event_start_date, event_end_date, event_start_time, event_end_time, event_is_recurring, event_recurrence_rule = admin
                has_conflict = False

                if not proposed_is_recurring and not event_is_recurring:
                    dates_overlap = proposed_start_date <= event_end_date and proposed_end_date >= event_start_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, event_start_time, event_end_time)
                    has_conflict = dates_overlap and time_overlap

                elif not proposed_is_recurring and event_is_recurring:
                    in_range = event_start_date <= proposed_start_date <= event_end_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, event_start_time, event_end_time)
                    day_matches = event_recurrence_rule != 'weekly' or days_of_week_match(proposed_start_date, event_start_date)
                    has_conflict = in_range and time_overlap and day_matches

                elif proposed_is_recurring and not event_is_recurring:
                    in_range = proposed_start_date <= event_start_date <= proposed_end_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, event_start_time, event_end_time)
                    day_matches = proposed_recurrence_rule != 'weekly' or days_of_week_match(event_start_date, proposed_start_date)
                    has_conflict = in_range and time_overlap and day_matches

                elif proposed_is_recurring and event_is_recurring:
                    dates_overlap = proposed_start_date <= event_end_date and proposed_end_date >= event_start_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, event_start_time, event_end_time)

                    if proposed_recurrence_rule == 'daily' or event_recurrence_rule == 'daily':
                        pattern_conflict = True
                    elif proposed_recurrence_rule == 'weekly' and event_recurrence_rule == 'weekly':
                        pattern_conflict = days_of_week_match(proposed_start_date, event_start_date)
                    else:
                        pattern_conflict = True

                    has_conflict = dates_overlap and time_overlap and pattern_conflict

                if has_conflict:
                    admin_conflicts_list.append({
                        "event_id": event_id,
                        "event_name": event_name,
                        "start_date": event_start_date.isoformat(),
                        "end_date": event_end_date.isoformat(),
                        "start_time": str(event_start_time),
                        "end_time": str(event_end_time),
                        "is_recurring": event_is_recurring,
                        "recurrence_rule": event_recurrence_rule
                    })

            return jsonify({
                "has_conflicts": bool(rental_conflicts_list or admin_conflicts_list),
                "rental_conflicts": rental_conflicts_list,
                "admin_conflicts": admin_conflicts_list
            })

    except Exception as e:
        print("Error checking conflicts:", str(e))
        return jsonify({"error": str(e)}), 500

def check_for_conflicts(data):
    try:
        data = request.get_json()
        print("Received conflict check data:", data)
        
        # Validate required fields
        required_fields = ['start_date', 'end_date', 'start_time', 'end_time']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400

        # Convert strings to date and time objects
        proposed_start_date = datetime.strptime(data['start_date'], '%m/%d/%Y').date()
        proposed_end_date = datetime.strptime(data['end_date'], '%m/%d/%Y').date()
        proposed_start_time = datetime.strptime(data['start_time'], '%I:%M %p').time()
        proposed_end_time = datetime.strptime(data['end_time'], '%I:%M %p').time()

        proposed_is_recurring = data.get('is_recurring', False)
        proposed_recurrence_rule = data.get('recurrence_rule')

        with pool.connect() as conn:
            rental_query = sqlalchemy.text("""
                SELECT 
                    request_id, 
                    rental_name, 
                    start_date, 
                    end_date, 
                    start_time, 
                    end_time, 
                    is_recurring,
                    recurrence_rule,
                    rental_status
                FROM public.rental_request
                WHERE 
                    rental_status IN ('approved', 'admin')
            """)
            rental_results = conn.execute(rental_query).fetchall()

            admin_query = sqlalchemy.text("""
                SELECT 
                    event_id, 
                    event_name, 
                    start_date, 
                    end_date, 
                    start_time, 
                    end_time,
                    is_recurring,
                    recurrence_rule
                FROM public.admin_event
            """)
            admin_results = conn.execute(admin_query).fetchall()

            rental_conflicts_list = []
            admin_conflicts_list = []

            def times_overlap(t1_start, t1_end, t2_start, t2_end):
                return t1_start <= t2_end and t1_end >= t2_start

            def days_of_week_match(d1, d2):
                return d1.weekday() == d2.weekday()

            for rental in rental_results:
                rental_id, rental_name, rental_start_date, rental_end_date, rental_start_time, rental_end_time, rental_is_recurring, rental_recurrence_rule, rental_status = rental
                has_conflict = False

                if not proposed_is_recurring and not rental_is_recurring:
                    dates_overlap = proposed_start_date <= rental_end_date and proposed_end_date >= rental_start_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, rental_start_time, rental_end_time)
                    has_conflict = dates_overlap and time_overlap

                elif not proposed_is_recurring and rental_is_recurring:
                    in_range = rental_start_date <= proposed_start_date <= rental_end_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, rental_start_time, rental_end_time)
                    day_matches = rental_recurrence_rule != 'weekly' or days_of_week_match(proposed_start_date, rental_start_date)
                    has_conflict = in_range and time_overlap and day_matches

                elif proposed_is_recurring and not rental_is_recurring:
                    in_range = proposed_start_date <= rental_start_date <= proposed_end_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, rental_start_time, rental_end_time)
                    day_matches = proposed_recurrence_rule != 'weekly' or days_of_week_match(rental_start_date, proposed_start_date)
                    has_conflict = in_range and time_overlap and day_matches

                elif proposed_is_recurring and rental_is_recurring:
                    dates_overlap = proposed_start_date <= rental_end_date and proposed_end_date >= rental_start_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, rental_start_time, rental_end_time)

                    if proposed_recurrence_rule == 'daily' or rental_recurrence_rule == 'daily':
                        pattern_conflict = True
                    elif proposed_recurrence_rule == 'weekly' and rental_recurrence_rule == 'weekly':
                        pattern_conflict = days_of_week_match(proposed_start_date, rental_start_date)
                    else:
                        pattern_conflict = True

                    has_conflict = dates_overlap and time_overlap and pattern_conflict

                if has_conflict:
                    return True

            for admin in admin_results:
                event_id, event_name, event_start_date, event_end_date, event_start_time, event_end_time, event_is_recurring, event_recurrence_rule = admin
                has_conflict = False

                if not proposed_is_recurring and not event_is_recurring:
                    dates_overlap = proposed_start_date <= event_end_date and proposed_end_date >= event_start_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, event_start_time, event_end_time)
                    has_conflict = dates_overlap and time_overlap

                elif not proposed_is_recurring and event_is_recurring:
                    in_range = event_start_date <= proposed_start_date <= event_end_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, event_start_time, event_end_time)
                    day_matches = event_recurrence_rule != 'weekly' or days_of_week_match(proposed_start_date, event_start_date)
                    has_conflict = in_range and time_overlap and day_matches

                elif proposed_is_recurring and not event_is_recurring:
                    in_range = proposed_start_date <= event_start_date <= proposed_end_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, event_start_time, event_end_time)
                    day_matches = proposed_recurrence_rule != 'weekly' or days_of_week_match(event_start_date, proposed_start_date)
                    has_conflict = in_range and time_overlap and day_matches

                elif proposed_is_recurring and event_is_recurring:
                    dates_overlap = proposed_start_date <= event_end_date and proposed_end_date >= event_start_date
                    time_overlap = times_overlap(proposed_start_time, proposed_end_time, event_start_time, event_end_time)

                    if proposed_recurrence_rule == 'daily' or event_recurrence_rule == 'daily':
                        pattern_conflict = True
                    elif proposed_recurrence_rule == 'weekly' and event_recurrence_rule == 'weekly':
                        pattern_conflict = days_of_week_match(proposed_start_date, event_start_date)
                    else:
                        pattern_conflict = True

                    has_conflict = dates_overlap and time_overlap and pattern_conflict

                if has_conflict:
                    return True
        return False

    except Exception as e:
        print("Error checking conflicts:", str(e))
        return jsonify({"error": str(e)}), 500

@app.route('/api/submit_request', methods=['POST'])
@limiter.limit("10 per day")
@require_authentication
def submit_request():
    """Submit a new ice slot request"""
    try:
        data = request.get_json()
        print("Received request data:", data)
        
        required_fields = ['firebase_uid', 'rental_name', 'start_date', 'end_date', 
                         'start_time', 'end_time', 'is_recurring']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400
        
        conflict_data = {
            'start_date': data['start_date'],
            'end_date': data['end_date'],
            'start_time': data['start_time'],
            'end_time': data['end_time'],
            'is_recurring': data['is_recurring'],
            'recurrence_rule': data.get('recurrence_rule', None) if data['is_recurring'] else None
        }
        
        conflict_result = check_for_conflicts(conflict_data)
        
        if conflict_result:
            return jsonify({"error": "Schedule conflicts with existing bookings"}), 409

        with pool.connect() as conn:
            # Get user_id from firebase_uid
            user_query = sqlalchemy.text("""
                SELECT renter_id FROM public.renter 
                WHERE firebase_uid = :firebase_uid
            """)
            user_result = conn.execute(
                user_query,
                {"firebase_uid": data['firebase_uid']}
            ).fetchone()
            
            if not user_result:
                return jsonify({"error": "User not found"}), 404
                
            user_id = user_result[0]
            
            # Insert the new request
            insert_query = sqlalchemy.text("""
                INSERT INTO public.rental_request 
                (user_id, rental_name, additional_desc, start_date, end_date, 
                 start_time, end_time, rental_status, is_recurring, 
                 recurrence_rule, request_date)
                VALUES 
                (:user_id, :rental_name, :additional_desc, :start_date, :end_date,
                 :start_time, :end_time, 'pending', :is_recurring,
                 CASE WHEN :is_recurring THEN :recurrence_rule ELSE NULL END,
                 NOW())
                RETURNING request_id
            """)
            
            result = conn.execute(
                insert_query,
                {
                    "user_id": user_id,
                    "rental_name": data['rental_name'],
                    "additional_desc": data.get('additional_desc', ''),
                    "start_date": data['start_date'],
                    "end_date": data['end_date'],
                    "start_time": data['start_time'],
                    "end_time": data['end_time'],
                    "is_recurring": data['is_recurring'],
                    "recurrence_rule": data.get('recurrence_rule', 'daily')
                }
            )
            
            
            return jsonify({
                "message": "Request submitted successfully",
                "request_id": result.fetchone()[0]
            })
            
    except Exception as e:
        print("Error submitting request:", str(e))
        return jsonify({"error": str(e)}), 500

@app.route('/api/submit_event', methods=['POST'])
@require_admin(pool)
def submit_event():
    """Submit a new ice slot request"""
    try:
        data = request.get_json()
        print("Received request data:", data)
        
        required_fields = ['firebase_uid', 'rental_name', 'start_date', 'end_date', 
                         'start_time', 'end_time', 'is_recurring']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400
        
        conflict_data = {
            'start_date': data['start_date'],
            'end_date': data['end_date'],
            'start_time': data['start_time'],
            'end_time': data['end_time'],
            'is_recurring': data['is_recurring'],
            'recurrence_rule': data.get('recurrence_rule', None) if data['is_recurring'] else None
        }

        conflict_result = check_for_conflicts(conflict_data)
        
        if conflict_result:
            return jsonify({"error": "Schedule conflicts with existing bookings"}), 409

        with pool.connect() as conn:
            # Get user_id from firebase_uid
            user_query = sqlalchemy.text("""
                SELECT admin_id FROM public.admin
                WHERE firebase_uid = :firebase_uid
            """)
            user_result = conn.execute(
                user_query,
                {"firebase_uid": data['firebase_uid']}
            ).fetchone()
            
            if not user_result:
                return jsonify({"error": "User not found"}), 404
                
            admin_id = user_result[0]
            
            # Insert the new request
            insert_query = sqlalchemy.text("""
                INSERT INTO public.admin_event 
                (admin_id, event_name, additional_desc, start_date, end_date, 
                 start_time, end_time, is_recurring, 
                 recurrence_rule, created_date)
                VALUES 
                (:admin_id, :event_name, :additional_desc, :start_date, :end_date,
                 :start_time, :end_time, :is_recurring,
                 CASE WHEN :is_recurring THEN :recurrence_rule ELSE NULL END,
                 NOW())
                RETURNING event_id
            """)
            
            result = conn.execute(
                insert_query,
                {
                    "admin_id": admin_id,
                    "event_name": data['rental_name'],
                    "additional_desc": data.get('additional_desc', ''),
                    "start_date": data['start_date'],
                    "end_date": data['end_date'],
                    "start_time": data['start_time'],
                    "end_time": data['end_time'],
                    "is_recurring": data['is_recurring'],
                    "recurrence_rule": data.get('recurrence_rule', 'daily')                }
            )
            
            
            return jsonify({
                "message": "Request submitted successfully",
                "request_id": result.fetchone()[0]
            })
            
    except Exception as e:
        print("Error submitting request:", str(e))
        return jsonify({"error": str(e)}), 500

@app.route('/api/check_user_email', methods=['POST'])
@require_admin(pool)
def check_user_email():
    """Check if a user exists in the database by email"""
    try:
        data = request.get_json()
        email = data.get('email')
        
        if not email:
            return jsonify({"error": "Email is required"}), 400
        
        with pool.connect() as conn:
            # Check if user exists
            user_query = sqlalchemy.text("""
                SELECT EXISTS(
                    SELECT 1 FROM public.renter 
                    WHERE renter_email = :email
                ) as user_exists
            """)
            result = conn.execute(
                user_query,
                {"email": email}
            ).fetchone()
            
            return jsonify({
                "exists": result[0]  # Returns True/False
            })
            
    except Exception as e:
        print("Error checking user:", str(e))
        return jsonify({"error": str(e)}), 500

@app.route('/api/submit_admin_request', methods=['POST'])
@require_admin(pool)
def submit_admin_request():
    """Submit an admin request on behalf of a user and send email notification"""
    try:
        data = request.get_json()
        print("Received admin request data:", data)
        
        # Required fields validation
        required_fields = [
            'firebase_uid', 'user_email', 'rental_name', 
            'start_date', 'end_date', 'start_time', 'end_time', 'amount'
        ]
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400
        
        conflict_data = {
            'start_date': data['start_date'],
            'end_date': data['end_date'],
            'start_time': data['start_time'],
            'end_time': data['end_time'],
            'is_recurring': data['is_recurring'],
            'recurrence_rule': data.get('recurrence_rule', None) if data['is_recurring'] else None
        }

        conflict_result = check_for_conflicts(conflict_data)
        
        if conflict_result:
            return jsonify({"error": "Schedule conflicts with existing bookings"}), 409

        with pool.connect() as conn:
            
            # 1. Get user_id from email
            user_query = sqlalchemy.text("""
                SELECT renter_id FROM public.renter 
                WHERE renter_email = :email
            """)
            user_result = conn.execute(
                user_query,
                {"email": data['user_email']}
            ).fetchone()
            
            if not user_result:
                return jsonify({"error": "Target user not found"}), 404
                
            user_id = user_result[0]
            
            # 2. Insert the admin request
            insert_query = sqlalchemy.text("""
                INSERT INTO public.rental_request 
                (user_id, rental_name, additional_desc, start_date, end_date, 
                start_time, end_time, rental_status, is_recurring,
                recurrence_rule, request_date, amount)
                VALUES 
                (:user_id, :rental_name, :additional_desc, :start_date, :end_date,
                :start_time, :end_time, 'admin', :is_recurring,
                CASE WHEN :is_recurring THEN :recurrence_rule ELSE NULL END,
                NOW(), :amount)
                RETURNING request_id
            """)
            
            result = conn.execute(
                insert_query,
                {
                    "user_id": user_id,
                    "rental_name": data['rental_name'],
                    "additional_desc": data.get('additional_desc', ''),
                    "start_date": data['start_date'],
                    "end_date": data['end_date'],
                    "start_time": data['start_time'],
                    "end_time": data['end_time'],
                    "is_recurring": data.get('is_recurring', False),
                    "recurrence_rule": data.get('recurrence_rule', 'daily'),
                    "amount": data['amount']
                }
            )
            
            request_id = result.fetchone()[0]
            
            # Send email notification to the user
            user_email = data['user_email']
            rental_name = data['rental_name']
            start_date = data['start_date']
            end_date = data['end_date']
            start_time = data['start_time']
            end_time = data['end_time']
            amount = float(data['amount'])
            
            email_subject = f"Ice rental: {rental_name}"
            email_body = f"""
            <html>
            <body>
                <h2>You have a new ice rental event</h2>
                <p>An administrator has created a rental request on your behalf.</p>
                <p><strong>Rental:</strong> {rental_name}</p>
                <p><strong>Dates:</strong> {start_date} to {end_date}</p>
                <p><strong>Time:</strong> {start_time} to {end_time}</p>
                <p><strong>Amount:</strong> ${amount:.2f}</p>
                <p>You can pay by cash, cheque or credit card at the time of the event. You will be invoiced monthly for unpaid rentals.</p>
                <p>If you have any questions, please contact lnorris@clarkson.edu.</p>
            </body>
            </html>
            """
            
            # Send email via Gmail API
            service = get_gmail_service()
            if not service:
                print("Error: Gmail service unavailable")
                return jsonify({
                    'success': True, 
                    'message': 'Admin request created but email notification failed to send',
                    'request_id': request_id,
                    'email_sent': False
                })
            
            message = MIMEText(email_body, 'html')
            message['to'] = user_email
            message['subject'] = email_subject
            
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')
            message_object = {'raw': raw_message}
            
            sent_message = service.users().messages().send(
                userId='me', 
                body=message_object
            ).execute()
            
            print(f"Admin request notification email sent successfully to {user_email}")
            
            return jsonify({
                "success": True,
                "message": "Admin request submitted successfully and notification sent",
                "request_id": request_id,
                "email_sent": True,
                "email_id": sent_message.get('id', None)
            })
        
    except Exception as e:
        print("Error submitting admin request:", str(e))
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/user_requests/<firebase_uid>')
@require_authentication
def get_user_requests(firebase_uid):
    """Get all requests (pending, accepted, and declined) for a specific user"""
    if not firebase_uid or not isinstance(firebase_uid, str):
        return jsonify({"error": "Invalid firebase_uid"}), 400

    try:
        with pool.connect() as conn:
            # Get user_id from firebase_uid
            user_query = sqlalchemy.text("""
                SELECT renter_id FROM public.renter 
                WHERE firebase_uid = :firebase_uid
            """)
            user_result = conn.execute(
                user_query,
                {"firebase_uid": firebase_uid}
            ).fetchone()
            
            if not user_result:
                return jsonify({"error": "User not found"}), 404
                
            user_id = user_result[0]
            
            # Convert RowMapping to dictionary for JSON serialization
            def row_to_dict(row):
                return {key: value for key, value in row._mapping.items()}
            
            # Get pending requests
            pending_query = sqlalchemy.text("""
                SELECT 
                    request_id, 
                    rental_name, 
                    additional_desc, 
                    TO_CHAR(start_date, 'MM/DD/YYYY') as start_date,
                    TO_CHAR(end_date, 'MM/DD/YYYY') as end_date,
                    TO_CHAR(start_time, 'HH12:MI AM') as start_time,
                    TO_CHAR(end_time, 'HH12:MI AM') as end_time,
                    is_recurring, 
                    recurrence_rule,
                    request_date,
                    'pending' as request_status,
                    NULL as declined_reason
                FROM public.rental_request
                WHERE user_id = :user_id 
                AND rental_status = 'pending'
                ORDER BY start_date, start_time
            """)
            
            pending = [row_to_dict(row) for row in conn.execute(
                pending_query,
                {"user_id": user_id}
            )]
            
            # Get accepted requests
            accepted_query = sqlalchemy.text("""
                SELECT 
                    request_id, 
                    rental_name, 
                    additional_desc, 
                    TO_CHAR(start_date, 'MM/DD/YYYY') as start_date,
                    TO_CHAR(end_date, 'MM/DD/YYYY') as end_date,
                    TO_CHAR(start_time, 'HH12:MI AM') as start_time,
                    TO_CHAR(end_time, 'HH12:MI AM') as end_time,
                    is_recurring, 
                    recurrence_rule,
                    request_date,
                    'approved' as request_status,
                    NULL as declined_reason
                FROM public.rental_request
                WHERE user_id = :user_id 
                AND rental_status = 'approved'
                ORDER BY start_date, start_time
            """)
            
            accepted = [row_to_dict(row) for row in conn.execute(
                accepted_query,
                {"user_id": user_id}
            )]

            # Get admin requests
            admin_query = sqlalchemy.text("""
                SELECT 
                    request_id, 
                    rental_name, 
                    additional_desc, 
                    TO_CHAR(start_date, 'MM/DD/YYYY') as start_date,
                    TO_CHAR(end_date, 'MM/DD/YYYY') as end_date,
                    TO_CHAR(start_time, 'HH12:MI AM') as start_time,
                    TO_CHAR(end_time, 'HH12:MI AM') as end_time,
                    is_recurring, 
                    recurrence_rule,
                    request_date,
                    'admin' as request_status,
                    NULL as declined_reason
                FROM public.rental_request
                WHERE user_id = :user_id 
                AND rental_status = 'admin'
                ORDER BY start_date, start_time
            """)
            
            admin = [row_to_dict(row) for row in conn.execute(
                admin_query,
                {"user_id": user_id}
            )]
            
            # Get declined requests with reason
            declined_query = sqlalchemy.text("""
                SELECT 
                    request_id, 
                    rental_name, 
                    additional_desc, 
                    TO_CHAR(start_date, 'MM/DD/YYYY') as start_date,
                    TO_CHAR(end_date, 'MM/DD/YYYY') as end_date,
                    TO_CHAR(start_time, 'HH12:MI AM') as start_time,
                    TO_CHAR(end_time, 'HH12:MI AM') as end_time,
                    is_recurring, 
                    recurrence_rule,
                    request_date,
                    'declined' as request_status,
                    declined_reason
                FROM public.rental_request
                WHERE user_id = :user_id 
                AND rental_status = 'denied'
                ORDER BY start_date, start_time
            """)
            
            declined = [row_to_dict(row) for row in conn.execute(
                declined_query,
                {"user_id": user_id}
            )]
            
            return jsonify({
                "requests": pending + accepted + declined + admin
            })
            
    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error fetching requests for {firebase_uid}: {str(e)}")
        return jsonify({"error": "Database error occurred"}), 500
    except Exception as e:
        print(f"Unexpected error fetching requests for {firebase_uid}: {str(e)}")
        return jsonify({"error": "An unexpected error occurred"}), 500

@app.route('/api/admin/user-requests/<int:user_id>')
@require_admin(pool)
def admin_get_user_requests(user_id):
    """Get all rental requests for a specific user with payment filtering"""
    try:
        with pool.connect() as conn:
            # Convert RowMapping to dictionary for JSON serialization
            def row_to_dict(row):
                return {key: value for key, value in row._mapping.items()}
            
            # Base query
            query = sqlalchemy.text("""
                SELECT 
                    rr.request_id, 
                    rr.rental_name, 
                    rr.additional_desc, 
                    TO_CHAR(rr.start_date, 'YYYY-MM-DD') as start_date,
                    TO_CHAR(rr.end_date, 'YYYY-MM-DD') as end_date,
                    TO_CHAR(rr.start_time, 'HH12:MI AM') as start_time,
                    TO_CHAR(rr.end_time, 'HH12:MI AM') as end_time,
                    rr.is_recurring, 
                    rr.recurrence_rule,
                    rr.request_date,
                    CASE 
                        WHEN rr.rental_status = 'pending' THEN 'pending'
                        WHEN rr.rental_status = 'approved' THEN 'approved'
                        WHEN rr.rental_status = 'denied' THEN 'declined'
                        ELSE rr.rental_status
                    END as request_status,
                    rr.amount,
                    rr.paid,
                    rr.declined_reason,
                    r.renter_email as user_email,
                    CONCAT(r.first_name, ' ', r.last_name) as user_name,
                    r.phone as user_phone,
                    EXTRACT(MONTH FROM rr.start_date) as month,
                    EXTRACT(YEAR FROM rr.start_date) as year
                FROM public.rental_request rr
                JOIN public.renter r ON rr.user_id = r.renter_id
                WHERE rr.user_id = :user_id
                ORDER BY rr.start_date DESC, rr.start_time
            """)
            
            requests = [row_to_dict(row) for row in conn.execute(query, {"user_id": user_id})]
            
            # Get user information
            user_query = sqlalchemy.text("""
                SELECT 
                    renter_id as user_id,
                    CONCAT(first_name, ' ', last_name) as full_name,
                    renter_email as email,
                    phone
                FROM public.renter
                WHERE renter_id = :user_id
            """)
            
            user_result = conn.execute(user_query, {"user_id": user_id}).fetchone()
            user = row_to_dict(user_result) if user_result else None
            
            # Calculate payment summaries
            paid_total = sum(float(request['amount'] or 0) for request in requests if request['paid'])
            unpaid_total = sum(float(request['amount'] or 0) for request in requests 
                          if not request['paid'] and request['amount'] and request['request_status'] in ('approved','admin'))
            all_total = sum(float(request['amount'] or 0) for request in requests if request['amount'])
            
            return jsonify({
                "requests": requests,
                "user": user,
                "count": len(requests),
                "payment_summary": {
                    "paid": paid_total,
                    "unpaid": unpaid_total,
                    "total": all_total
                },
                "success": True
            })
            
    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error fetching user requests: {str(e)}")
        return jsonify({
            "error": "Database error occurred",
            "success": False
        }), 500
    except Exception as e:
        print(f"Unexpected error fetching user requests: {str(e)}")
        return jsonify({
            "error": "An unexpected error occurred",
            "success": False
        }), 500

@app.route('/api/admin/events')
@require_admin(pool)
def get_admin_event():
    """Get all admin events (which are considered pre-approved)"""
    try:
        with pool.connect() as conn:
            # Convert RowMapping to dictionary for JSON serialization
            def row_to_dict(row):
                return {key: value for key, value in row._mapping.items()}
            
            # Get all admin events
            query = sqlalchemy.text("""
                SELECT 
                    event_id,
                    event_name as rental_name,
                    additional_desc as description,
                    TO_CHAR(start_date, 'MM/DD/YYYY') as start_date,
                    TO_CHAR(end_date, 'MM/DD/YYYY') as end_date,
                    TO_CHAR(start_time, 'HH12:MI AM') as start_time,
                    TO_CHAR(end_time, 'HH12:MI AM') as end_time,
                    is_recurring,
                    recurrence_rule,
                    created_date,
                    admin_id
                FROM public.admin_event
                ORDER BY start_date, start_time
            """)
            
            events = [row_to_dict(row) for row in conn.execute(query)]
            
            return jsonify({
                "events": events
            })
            
    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error fetching admin events: {str(e)}")
        return jsonify({"error": "Database error occurred"}), 500
    except Exception as e:
        print(f"Unexpected error fetching admin events: {str(e)}")
        return jsonify({"error": "An unexpected error occurred"}), 500

@app.route('/api/admin/requests')
@require_admin(pool)
def get_all_requests():
    """Get all rental requests with user information for admin view"""
    try:
        with pool.connect() as conn:
            # Convert RowMapping to dictionary for JSON serialization
            def row_to_dict(row):
                return {key: value for key, value in row._mapping.items()}
            
            # Get all requests with user information
            query = sqlalchemy.text("""
                SELECT 
                    rr.request_id, 
                    rr.rental_name, 
                    rr.additional_desc, 
                    TO_CHAR(rr.start_date, 'YYYY-MM-DD') as start_date,
                    TO_CHAR(rr.end_date, 'YYYY-MM-DD') as end_date,
                    TO_CHAR(rr.start_time, 'HH12:MI AM') as start_time,
                    TO_CHAR(rr.end_time, 'HH12:MI AM') as end_time,
                    rr.is_recurring, 
                    rr.recurrence_rule,
                    rr.request_date as request_date,
                    CASE 
                        WHEN rr.rental_status = 'pending' THEN 'pending'
                        WHEN rr.rental_status = 'approved' THEN 'approved'
                        WHEN rr.rental_status = 'denied' THEN 'declined'
                        ELSE rr.rental_status
                    END as request_status,
                    rr.amount as amount,
                    rr.paid as paid,
                    rr.declined_reason,
                    r.renter_email as user_email,
                    CONCAT(r.first_name, ' ', r.last_name) as user_name,
                    r.phone as user_phone
                FROM public.rental_request rr
                JOIN public.renter r ON rr.user_id = r.renter_id
                ORDER BY 
                    CASE WHEN rr.rental_status = 'pending' THEN 1
                         WHEN rr.rental_status = 'approved' THEN 2
                         ELSE 3 END,
                    rr.start_date, 
                    rr.start_time
            """)
            
            requests = [row_to_dict(row) for row in conn.execute(query)]
            
            return jsonify({
                "requests": requests,
                "count": len(requests),
                "success": True
            })
            
    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error fetching all requests: {str(e)}")
        return jsonify({
            "error": "Database error occurred",
            "success": False
        }), 500
    except Exception as e:
        print(f"Unexpected error fetching all requests: {str(e)}")
        return jsonify({
            "error": "An unexpected error occurred",
            "success": False
        }), 500

@app.route('/api/admin/mark_paid/<requestId>', methods=['POST'])
@require_admin(pool)
def mark_paid(requestId):
    """Mark a request as paid and return user email"""
    try:
        with pool.connect() as conn:
            # Check if request exists and get current status with user email
            check_query = sqlalchemy.text("""
                SELECT rr.request_id, rr.paid, r.renter_email as user_email
                FROM rental_request rr
                JOIN public.renter r ON rr.user_id = r.renter_id
                WHERE rr.request_id = :request_id
            """)
            existing = conn.execute(
                check_query,
                {"request_id": requestId}
            ).fetchone()

            if not existing:
                return jsonify({"error": "Request not found"}), 404

            if existing.paid:
                return jsonify({"error": "Request is already marked as paid"}), 400

            # Update the paid status and return relevant data
            update_query = sqlalchemy.text("""
                WITH updated AS (
                    UPDATE rental_request
                    SET paid = TRUE
                    WHERE request_id = :request_id
                    RETURNING 
                        request_id, 
                        rental_name, 
                        user_id,
                        amount
                )
                SELECT 
                    u.request_id,
                    u.rental_name,
                    r.renter_email as user_email,
                    u.amount
                FROM updated u
                JOIN public.renter r ON u.user_id = r.renter_id
            """)
            
            result = conn.execute(
                update_query,
                {"request_id": requestId}
            ).fetchone()

            

            return jsonify({
                "success": True,
                "message": "Request marked as paid",
                "data": {
                    "request_id": result.request_id,
                    "rental_name": result.rental_name,
                    "user_email": result.user_email,
                    "amount": float(result.amount) if result.amount else None
                }
            })

    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error marking request {requestId} as paid: {str(e)}")
        return jsonify({"error": "Database error occurred"}), 500
    except Exception as e:
        print(f"Unexpected error marking request {requestId} as paid: {str(e)}")
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route('/api/admin/events/delete/<event_id>', methods=['DELETE'])
@require_admin(pool)
def delete_admin_event(event_id):
    """Delete an admin event"""
    try:
        with pool.connect() as conn:
            # Delete the event
            delete_query = sqlalchemy.text("""
                DELETE FROM public.admin_event
                WHERE event_id = :event_id
                RETURNING event_id
            """)
            
            result = conn.execute(
                delete_query,
                {"event_id": event_id}
            ).fetchone()
            
            if not result:
                return jsonify({"error": "Event not found"}), 404
                
            
            return jsonify({"success": True, "message": "Event deleted"})
            
    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error deleting event {event_id}: {str(e)}")
        return jsonify({"error": "Database error occurred"}), 500
    except Exception as e:
        print(f"Unexpected error deleting event {event_id}: {str(e)}")
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route('/api/admin/events/update/<eventId>', methods=['POST'])  # Use POST or PUT for updates
@require_admin(pool)
def edit_event(eventId):
    """Edit end date of a recurring request"""
    try:
        data = request.get_json()
        new_end_date = data.get("end_date")  # Expected in 'YYYY-MM-DD' format

        if not new_end_date:
            return jsonify({"error": "Missing 'end_date' in request body"}), 400

        with pool.connect() as conn:
            update_query = sqlalchemy.text("""
                UPDATE public.admin_event
                SET end_date = :end_date
                WHERE event_id = :event_id
                RETURNING event_id
            """)
            
            result = conn.execute(
                update_query,
                {
                    "end_date": new_end_date,
                    "event_id": eventId
                }
            ).fetchone()

            if not result:
                return jsonify({"error": "Request not found"}), 404

            
            return jsonify({"success": True, "message": "Request updated"})

    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error updating request {eventId}: {str(e)}")
        return jsonify({"error": "Database error occurred"}), 500
    except Exception as e:
        print(f"Unexpected error updating request {eventId}: {str(e)}")
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route('/api/admin/approve_request/<request_id>', methods=['POST'])
@require_admin(pool)
def approve_request(request_id):
    """Approve a rental request and send email notification if requested"""
    try:
        data = request.json
        amount = float(data.get('amount', 0))
        send_email = data.get('sendEmail', False)
        
        # Additional email data
        rental_name = data.get('rentalName', '')
        start_date = data.get('startDate', '')
        end_date = data.get('endDate', '')
        user_email = data.get('userEmail', '')
        
        # Update request status in database
        with pool.connect() as conn:
            update_query = sqlalchemy.text("""
                UPDATE public.rental_request 
                SET rental_status = 'approved', amount = :amount
                FROM public.renter
                WHERE public.rental_request.user_id = public.renter.renter_id
                AND request_id = :request_id
                RETURNING renter_email, rental_name, start_date, end_date
            """)

            result = conn.execute(update_query, {
                "request_id": request_id,
                "amount": amount
            })
            
            
            # Get returned values if they weren't provided in the request
            row = result.fetchone()
            if row:
                if not user_email:
                    user_email = row[0]
                if not rental_name:
                    rental_name = row[1]
                if not start_date:
                    start_date = row[2]
                if not end_date:
                    end_date = row[3]
        
        # Send email notification if requested
        if send_email and user_email:
            email_subject = f"Rental Request Approved: {rental_name}"
            email_body = f"""
            <html>
            <body>
                <h2>Rental Request Approved</h2>
                <p>Good news! Your rental request has been approved.</p>
                <p><strong>Rental:</strong> {rental_name}</p>
                <p><strong>Dates:</strong> {start_date} to {end_date}</p>
                <p><strong>Amount:</strong> ${amount:.2f}</p>
                <p>You can pay by cash,cheque or credit card at the time of the event, You will be invoiced monthly for unpaid rentals.</p>
                <p>Thank you for your request. If you have any questions, please contact lnorris@clarkson.edu.</p>
            </body>
            </html>
            """
            
            # Send email via Gmail API
            service = get_gmail_service()
            if not service:
                print("Error: Gmail service unavailable")
                return jsonify({
                    'success': True, 
                    'message': 'Request approved but email notification failed to send',
                    'email_sent': False
                })
            
            message = MIMEText(email_body, 'html')
            message['to'] = user_email
            message['subject'] = email_subject
            
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')
            message_object = {'raw': raw_message}
            
            sent_message = service.users().messages().send(
                userId='me', 
                body=message_object
            ).execute()
            
            print(f"Approval email sent successfully to {user_email}")
            
            return jsonify({
                'success': True,
                'message': 'Request approved and notification sent',
                'email_sent': True,
                'email_id': sent_message.get('id', None)
            })
        
        return jsonify({
            'success': True,
            'message': 'Request approved successfully',
            'email_sent': False
        })
    
    except Exception as e:
        print(f"Error in approve_request: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/decline_request/<request_id>', methods=['POST'])
@require_admin(pool)
def decline_request(request_id):
    """Decline a rental request and send email notification if requested"""
    try:
        data = request.json
        reason = data.get('reason', 'No reason provided')
        send_email = data.get('sendEmail', False)
        
        # Additional email data
        rental_name = data.get('rentalName', '')
        start_date = data.get('startDate', '')
        end_date = data.get('endDate', '')
        user_email = data.get('userEmail', '')
        
        # Update request status in database
        with pool.connect() as conn:
            update_query = sqlalchemy.text("""
                UPDATE public.rental_request 
                SET rental_status = 'denied', 
                declined_reason = :reason
                FROM public.renter
                WHERE public.rental_request.user_id = public.renter.renter_id
                AND request_id = :request_id
                RETURNING renter_email, rental_name, start_date, end_date
            """)
            result = conn.execute(update_query, {
                "request_id": request_id,
                "reason": reason
            })
            
            
            # Get returned values if they weren't provided in the request
            row = result.fetchone()
            if row:
                if not user_email:
                    user_email = row[0]
                if not rental_name:
                    rental_name = row[1]
                if not start_date:
                    start_date = row[2]
                if not end_date:
                    end_date = row[3]
        
        # Send email notification if requested
        if send_email and user_email:
            email_subject = f"Rental Request Declined: {rental_name}"
            email_body = f"""
            <html>
            <body>
                <h2>Rental Request Declined</h2>
                <p>We're sorry, but your rental request has been declined.</p>
                <p><strong>Rental:</strong> {rental_name}</p>
                <p><strong>Dates:</strong> {start_date} to {end_date}</p>
                <p><strong>Reason:</strong> {reason}</p>
                <p>If you have any questions or would like to discuss this further, please contact lnorris@clarkson.edu.</p>
            </body>
            </html>
            """
            
            # Send email via Gmail API
            service = get_gmail_service()
            if not service:
                print("Error: Gmail service unavailable")
                return jsonify({
                    'success': True, 
                    'message': 'Request declined but email notification failed to send',
                    'email_sent': False
                })
            
            message = MIMEText(email_body, 'html')
            message['to'] = user_email
            message['subject'] = email_subject
            
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')
            message_object = {'raw': raw_message}
            
            sent_message = service.users().messages().send(
                userId='me', 
                body=message_object
            ).execute()
            
            print(f"Decline email sent successfully to {user_email}")
            
            return jsonify({
                'success': True,
                'message': 'Request declined and notification sent',
                'email_sent': True,
                'email_id': sent_message.get('id', None)
            })
        
        return jsonify({
            'success': True,
            'message': 'Request declined successfully',
            'email_sent': False
        })
    
    except Exception as e:
        print(f"Error in decline_request: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/requests/update_amount/<request_id>', methods=['POST'])
@require_admin(pool)
def update_request_amount(request_id):
    """Update the amount for an approved rental request"""
    try:
        data = request.get_json() or {}
        amount = data.get('amount')
        
        if amount is None:
            return jsonify({"error": "Amount is required"}), 400
        
        with pool.connect() as conn:  # Establishing the connection here
            # Update only the amount for the existing approved request
            update_query = sqlalchemy.text("""
                UPDATE public.rental_request
                SET amount = :amount
                WHERE request_id = :request_id
                AND rental_status in ('approved','admin')
                RETURNING request_id
            """)
            
            result = conn.execute(
                update_query,
                {
                    "request_id": request_id,
                    "amount": amount
                }
            )
            
        
        # Check if any row was updated
        if result.rowcount == 0:
            return jsonify({"error": "Request not found or not in approved status"}), 404
        
        return jsonify({
            "message": "Amount updated successfully",
            "request_id": request_id,
            "amount": amount
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/admin/events/update_amount/<event_id>', methods=['POST'])
@require_admin(pool)
def update_event_amount(event_id):
    """Update the amount for an admin event"""
    try:
        data = request.get_json() or {}
        amount = data.get('amount')
        
        if amount is None:
            return jsonify({"error": "Amount is required"}), 400
        
        with pool.connect() as conn:
            # Update only the amount for the existing admin event
            update_query = sqlalchemy.text("""
                UPDATE public.admin_event
                SET amount = :amount
                WHERE event_id = :event_id
                RETURNING event_id
            """)
            
            result = conn.execute(
                update_query,
                {
                    "event_id": event_id,
                    "amount": amount
                }
            )
            

        # Check if any row was updated
        if result.rowcount == 0:
            return jsonify({"error": "Admin event not found"}), 404
        
        return jsonify({
            "message": "Amount updated successfully",
            "event_id": event_id,
            "amount": amount
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/delete_request/<request_id>', methods=['DELETE'])
@require_authentication
def delete_request(request_id):
    """Delete a specific request"""
    try:
        with pool.connect() as conn:
            # Verify the request exists and belongs to the user
            verify_query = sqlalchemy.text("""
                SELECT rr.user_id 
                FROM public.rental_request rr
                JOIN public.renter r ON rr.user_id = r.renter_id
                WHERE rr.request_id = :request_id
            """)
            result = conn.execute(verify_query, {"request_id": request_id}).fetchone()
            
            if not result:
                return jsonify({"error": "Request not found"}), 404
                
            # Delete the request
            delete_query = sqlalchemy.text("""
                DELETE FROM public.rental_request
                WHERE request_id = :request_id
            """)
            conn.execute(delete_query, {"request_id": request_id})
            
            # Commit the transaction to make it persistent
            
            
            return jsonify({"success": True})
            
    except Exception as e:
        print(f"Error deleting request {request_id}: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/events')
def get_events():
    """API endpoint to fetch events"""
    try:
        # Calculate date range (1 year back and 6 months forward)
        today = datetime.now().date()
        start_date = today - timedelta(days=365)
        end_date = today + timedelta(days=180)
        
        with pool.connect() as conn:
            # Query approved rental requests
            rental_query = sqlalchemy.text("""
                SELECT 
                    request_id as id,
                    rental_name as name,
                    additional_desc as description,
                    start_time::text as start_time,
                    end_time::text as end_time,
                    start_date::text as start_date,
                    end_date::text as end_date,
                    rental_status as status,
                    is_recurring,
                    recurrence_rule
                FROM public.rental_request 
                WHERE rental_status = 'approved'
                AND (
                    (is_recurring = false AND start_date BETWEEN :start AND :end)
                    OR 
                    (is_recurring = true AND end_date >= :start)
                )
            """)
            
            rentals = conn.execute(
                rental_query, 
                {"start": start_date, "end": end_date}
            ).mappings().all()
            
            # Query admin events
            admin_query = sqlalchemy.text("""
                SELECT 
                    event_id as id,
                    event_name as name,
                    additional_desc as description,
                    start_time::text as start_time,
                    end_time::text as end_time,
                    start_date::text as start_date,
                    end_date::text as end_date,
                    'admin' as status,
                    is_recurring,
                    recurrence_rule
                FROM public.admin_event
                WHERE (
                    (is_recurring = false AND start_date BETWEEN :start AND :end)
                    OR 
                    (is_recurring = true AND end_date >= :start)
                )
            """)
            
            admin_event = conn.execute(
                admin_query,
                {"start": start_date, "end": end_date}
            ).mappings().all()
            
            # Combine and process recurring events
            all_events = process_recurring_events(
                rentals + admin_event,
                start_date,
                end_date
            )
            
            return {"events": all_events}
            
    except Exception as e:
        return {"error": str(e)}, 500

def process_recurring_events(events, start_date, end_date):
    """Expand recurring events into individual occurrences"""
    processed_events = []
    
    for event in events:
        if not event['is_recurring']:
            # Single event - just format it
            processed_events.append(format_event(event, event['start_date']))
            continue
        
        # Handle recurring events
        current_date = datetime.strptime(event['start_date'], '%Y-%m-%d').date()
        end_date_recur = min(
            datetime.strptime(event['end_date'], '%Y-%m-%d').date(),
            end_date
        )
        
        if event['recurrence_rule'] == 'daily':
            while current_date <= end_date_recur:
                processed_events.append(format_event(event, current_date))
                current_date += timedelta(days=1)       
        elif event['recurrence_rule'] == 'weekly':
            original_weekday = current_date.weekday()
            while current_date <= end_date_recur:
                if current_date.weekday() == original_weekday:
                    processed_events.append(format_event(event, current_date))
                current_date += timedelta(days=1)
    
    return processed_events

def format_event(event, date):
    """Format an event for the frontend"""
    if isinstance(date, str):
        date_str = date
    else:
        date_str = date.strftime('%Y-%m-%d')
    time_str = f"{event['start_time']} - {event['end_time']}"
    
    return {
        'id': event['id'],
        'name': event['name'],
        'description': event.get('description', ''),
        'time': time_str,
        'date': date_str,
        'status': event['status'],
        'isRecurring': event['is_recurring'],
        'recurrenceRule': event.get('recurrence_rule')
    }

@app.route('/api/update_profile', methods=['POST'])
@require_authentication
def update_profile():
    """Update user profile information"""
    try:
        data = request.get_json()
        print("Received profile update data:", data)
        
        required_fields = ['firebase_uid', 'first_name', 'last_name', 'phone']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400
        
        with pool.connect() as conn:
            # Update the user profile
            update_query = sqlalchemy.text("""
                UPDATE public.renter
                SET first_name = :first_name,
                    last_name = :last_name,
                    phone = :phone
                WHERE firebase_uid = :firebase_uid
                RETURNING renter_id
            """)
            
            result = conn.execute(
                update_query,
                {
                    "firebase_uid": data['firebase_uid'],
                    "first_name": data['first_name'],
                    "last_name": data['last_name'],
                    "phone": data['phone']
                }
            )
            
            if result.rowcount == 0:
                return jsonify({"error": "User not found"}), 404
                
            
            
            return jsonify({
                "success": True,
                "message": "Profile updated successfully"
            })
            
    except Exception as e:
        print("Error updating profile:", str(e))
        return jsonify({"error": str(e)}), 500

@app.route('/api/admin/send_invoice', methods=['POST'])
@require_admin(pool)
def send_invoice():
    """Send invoice via Stripe and Gmail with payment link validity check via Stripe API"""
    try:
        data = request.json

        # Validate required fields
        required_fields = ['request_id', 'user_email', 'amount', 'rental_name', 'start_date', 'end_date']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400

        request_id = data['request_id']
        user_email = data['user_email']
        amount = float(data['amount'])
        rental_name = data['rental_name']
        start_date = data['start_date']
        end_date = data['end_date']
        print("amount: ", amount)

        # Check if there's already a payment link or invoice for this request
        with pool.connect() as conn:
            check_query = sqlalchemy.text(
                """
                SELECT 
                    payment_link,
                    paid
                FROM public.rental_request 
                WHERE request_id = :request_id
                """
            )
            result = conn.execute(check_query, {"request_id": request_id}).fetchone()

        create_new_invoice = True
        payment_link = None

        if result and result[0]:  # If payment_link exists
            existing_link = result[0]
            paid = result[1]

            if paid:
                print(f"Request {request_id} is already paid. No email needed.")
                return jsonify({
                    'success': True,
                    'message': 'Request is already paid. No invoice sent.',
                    'paid': True
                })
            else:
                payment_link = existing_link
                create_new_invoice = False
                print(f"Reusing existing invoice link for request {request_id}")

        # Create a new Invoice if needed
        if create_new_invoice:
            try:
                # 1. Create a Customer
                customer = stripe.Customer.create(
                    email=user_email,
                    metadata={"request_id": str(request_id)}
                )

                # 2. Create Invoice Item and wait for it to complete
                invoice_item = stripe.InvoiceItem.create(
                    customer=customer.id,
                    amount=int(amount * 100),  # Amount in cents
                    currency='usd',
                    description=f'Rental: {rental_name} ({start_date} to {end_date})'
                )
                print(f"Invoice item created: {invoice_item}")

                # 3. Create Invoice with auto_advance=True to automatically finalize
                invoice = stripe.Invoice.create(
                    customer=customer.id,
                    collection_method='send_invoice',
                    days_until_due=7,
                    auto_advance=True,  # Automatically finalize the invoice
                    metadata={"request_id": str(request_id)},
                    pending_invoice_items_behavior='include'
                )
                print(f"Invoice created: {invoice}")

                # 4. Explicitly finalize the invoice (not needed if auto_advance=True)
                finalized_invoice = stripe.Invoice.finalize_invoice(invoice.id)
                print(f"Finalized invoice: {finalized_invoice}")

                payment_link = finalized_invoice.hosted_invoice_url
                
                if not payment_link:
                    raise ValueError("No payment link generated by Stripe")

                print(f"[SUCCESS] Generated payment link: {payment_link} for request_id={request_id}")

                # Update DB with payment link and invoice id
                with pool.connect() as conn:
                    update_query = sqlalchemy.text(
                        """
                        UPDATE public.rental_request 
                        SET payment_link = :payment_link
                        WHERE request_id = :request_id
                        """
                    )
                    conn.execute(update_query, {
                        "payment_link": payment_link,
                        "request_id": request_id
                    })
                    

                print(f"Created new invoice for request {request_id}")

            except stripe.error.StripeError as e:
                print(f"Stripe error: {str(e)}")
                return jsonify({'error': f"Stripe payment processing error: {str(e)}"}), 500
            except Exception as e:
                print(f"Error creating invoice: {str(e)}")
                return jsonify({'error': f"Invoice creation failed: {str(e)}"}), 500

        # Send the email with the invoice link
        email_subject = f"Payment Invoice for {rental_name}"
        email_body = f"""
        <html>
        <body>
            <h2>Payment Invoice</h2>
            <p>Thank you for your rental request!</p>
            <p><strong>Rental:</strong> {rental_name}</p>
            <p><strong>Dates:</strong> {start_date} to {end_date}</p>
            <p><strong>Amount Due:</strong> ${amount:.2f}</p>
            <p>Please click the link below to view and pay your invoice:</p>
            <p><a href="{payment_link}">View Invoice</a></p>
            <p>If you have any questions, please contact lnorris@clarkson.edu.</p>
            <p>Thank you!</p>
        </body>
        </html>
        """

        # Send email via Gmail API
        service = get_gmail_service()
        if not service:
            print("Error: Gmail service unavailable")
            return jsonify({'error': 'Email service unavailable'}), 500

        message = MIMEText(email_body, 'html')
        message['to'] = user_email
        message['subject'] = email_subject

        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')
        message_object = {'raw': raw_message}

        sent_message = service.users().messages().send(
            userId='me', 
            body=message_object
        ).execute()

        print(f"Email sent successfully to {user_email} with {'existing' if not create_new_invoice else 'new'} invoice link")

        return jsonify({
            'success': True,
            'message': 'Invoice sent successfully',
            'email_id': sent_message.get('id', None),
            'payment_link': payment_link,
            'is_new_invoice': create_new_invoice
        })

    except Exception as e:
        print(f"Error in send_invoice: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# Generate monthly invoices for all users with unpaid rental requests
@functions_framework.http
@app.route('/api/admin/generate_monthly_invoices', methods=['POST'])
def generate_monthly_invoices():
    """
    Cloud Run function to generate monthly invoices for all users with unpaid rental requests
    This can be triggered by Cloud Scheduler on a monthly basis
    """
    try:
        # Get previous month and year
        now = datetime.now()
        # Calculate previous month
        if now.month == 1:  # January
            previous_month = 12
            previous_year = now.year - 1
        else:
            previous_month = now.month - 1
            previous_year = now.year
        
        print(f"Generating monthly invoices for previous month: {previous_month}/{previous_year}")
        
        # Find all users with unpaid rental requests
        with pool.connect() as conn:
            # Get all users with unpaid requests that haven't been included in a monthly invoice yet
            query = sqlalchemy.text("""
            WITH users_with_requests AS (
                SELECT DISTINCT 
                    r.renter_id as user_id,
                    r.renter_email as user_email,
                    CONCAT(r.first_name, ' ', r.last_name) as user_name
                FROM 
                    public.renter r
                JOIN 
                    public.rental_request rr ON r.renter_id = rr.user_id
                WHERE 
                    rr.rental_status in ('approved','admin') 
                    AND (rr.paid = FALSE OR rr.paid IS NULL)
                    AND EXTRACT(MONTH FROM rr.start_date) = :month
                    AND EXTRACT(YEAR FROM rr.start_date) = :year
            )
            SELECT 
                u.user_id,
                u.user_email,
                u.user_name,
                COALESCE(
                    (SELECT EXISTS(
                        SELECT 1 FROM public.monthly_invoice 
                        WHERE user_id = u.user_id 
                        AND invoice_month = :month 
                        AND invoice_year = :year
                    )), FALSE
                ) as invoice_exists
            FROM 
                users_with_requests u
            """)
            
            users = conn.execute(query, {"month": previous_month, "year": previous_year}).fetchall()
        
        print(f"Found {len(users)} users with unpaid rental requests")
        
        invoices_created = 0
        invoices_skipped = 0
        
        for user in users:
            user_id = user.user_id
            user_email = user.user_email
            user_name = user.user_name
            invoice_exists = user.invoice_exists
            
            if invoice_exists:
                print(f"Monthly invoice already exists for user {user_id} for {previous_month}/{previous_year}")
                invoices_skipped += 1
                continue
            
            # Calculate total amount due for this user for the previous month
            with pool.connect() as conn:
                amount_query = sqlalchemy.text("""
                SELECT 
                    SUM(amount) as total_amount,
                    array_agg(request_id) as request_ids,
                    array_agg(rental_name) as rental_names,
                    array_agg(TO_CHAR(start_date, 'YYYY-MM-DD')) as start_dates,
                    array_agg(TO_CHAR(end_date, 'YYYY-MM-DD')) as end_dates
                FROM 
                    public.rental_request
                WHERE 
                    user_id = :user_id
                    AND rental_status = 'approved'
                    AND (paid = FALSE OR paid IS NULL)
                    AND EXTRACT(MONTH FROM start_date) = :month
                    AND EXTRACT(YEAR FROM start_date) = :year
                """)
                
                result = conn.execute(amount_query, {
                    "user_id": user_id,
                    "month": previous_month,
                    "year": previous_year
                }).fetchone()
                
                if not result or not result.total_amount:
                    print(f"No unpaid rentals found for user {user_id}")
                    continue
                
                total_amount = result.total_amount
                request_ids = result.request_ids
                rental_names = result.rental_names
                start_dates = result.start_dates
                end_dates = result.end_dates
            
            print(f"Creating monthly invoice for user {user_id} in the amount of ${total_amount}")
            
            # Create a Stripe invoice
            try:
                # 1. Create or retrieve Customer
                customers = stripe.Customer.list(email=user_email, limit=1)
                
                if customers and customers.data:
                    customer = customers.data[0]
                    print(f"Using existing Stripe customer: {customer.id}")
                else:
                    customer = stripe.Customer.create(
                        email=user_email,
                        name=user_name,
                        metadata={"user_id": str(user_id)}
                    )
                    print(f"Created new Stripe customer: {customer.id}")
                
                # 2. Create Invoice Item
                invoice_description = f"Monthly Invoice - {previous_month}/{previous_year}"
                
                invoice_item = stripe.InvoiceItem.create(
                    customer=customer.id,
                    amount=int(total_amount * 100),  # Amount in cents
                    currency='usd',
                    description=invoice_description
                )
                
                # 3. Create Invoice with auto_advance=True to automatically finalize
                invoice = stripe.Invoice.create(
                    customer=customer.id,
                    collection_method='send_invoice',
                    days_until_due=7,
                    auto_advance=True,
                    metadata={
                        "user_id": str(user_id),
                        "month": str(previous_month),
                        "year": str(previous_year),
                        "request_ids": ",".join(map(str, request_ids))
                    },
                    pending_invoice_items_behavior='include'
                )
                
                # 4. Explicitly finalize the invoice
                finalized_invoice = stripe.Invoice.finalize_invoice(invoice.id)
                payment_link = finalized_invoice.hosted_invoice_url
                
                # 5. Insert record into monthly_invoice table
                with pool.connect() as conn:
                    insert_query = sqlalchemy.text("""
                    INSERT INTO public.monthly_invoice 
                    (user_id, invoice_month, invoice_year, amount, payment_link, stripe_invoice_id)
                    VALUES (:user_id, :month, :year, :amount, :payment_link, :stripe_invoice_id)
                    """)
                    
                    conn.execute(insert_query, {
                        "user_id": user_id,
                        "month": previous_month,
                        "year": previous_year,
                        "amount": total_amount,
                        "payment_link": payment_link,
                        "stripe_invoice_id": invoice.id
                    })
                
                # 6. Send email with invoice link
                send_monthly_invoice_email(
                    user_email=user_email,
                    user_name=user_name,
                    amount=total_amount,
                    payment_link=payment_link,
                    month=previous_month,
                    year=previous_year,
                    rental_names=rental_names,
                    start_dates=start_dates,
                    end_dates=end_dates
                )
                
                invoices_created += 1
                
            except stripe.error.StripeError as e:
                print(f"Stripe error for user {user_id}: {str(e)}")
                continue
            except Exception as e:
                print(f"Error creating invoice for user {user_id}: {str(e)}")
                traceback.print_exc()
                continue
        
        return jsonify({
            'success': True,
            'invoices_created': invoices_created,
            'invoices_skipped': invoices_skipped,
            'month': previous_month,
            'year': previous_year
        })
    
    except Exception as e:
        print(f"Error generating monthly invoices: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

def send_monthly_invoice_email(user_email, user_name, amount, payment_link, month, year, rental_names, start_dates, end_dates):
    """Send monthly invoice email to user"""
    try:
        # Create a table of rentals
        rental_rows = ""
        for i in range(len(rental_names)):
            rental_rows += f"""
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">{rental_names[i]}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">{start_dates[i]}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">{end_dates[i]}</td>
            </tr>
            """
        
        # Format month name
        month_name = datetime(year, month, 1).strftime('%B')
        
        email_subject = f"Monthly Invoice - {month_name} {year}"
        email_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Monthly Invoice - {month_name} {year}</h2>
            <p>Dear {user_name},</p>
            <p>Here is your monthly invoice for rentals during {month_name} {year}.</p>
            
            <h3>Rental Summary:</h3>
            <table style="border-collapse: collapse; width: 100%;">
                <tr style="background-color: #f2f2f2;">
                    <th style="padding: 8px; border: 1px solid #ddd;">Rental Name</th>
                    <th style="padding: 8px; border: 1px solid #ddd;">Start Date</th>
                    <th style="padding: 8px; border: 1px solid #ddd;">End Date</th>
                </tr>
                {rental_rows}
            </table>
            
            <p><strong>Total Amount Due:</strong> ${amount:.2f}</p>
            
            <p>Please click the link below to view and pay your invoice:</p>
            <p><a href="{payment_link}" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px;">Pay Invoice</a></p>
            
            <p>If you have any questions, please contact lnorris@clarkson.edu.</p>
            <p>Thank you!</p>
        </body>
        </html>
        """
        
        # Send email via Gmail API
        service = get_gmail_service()
        if not service:
            raise Exception("Gmail service unavailable")
        
        message = MIMEText(email_body, 'html')
        message['to'] = user_email
        message['subject'] = email_subject
        
        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')
        message_object = {'raw': raw_message}
        
        sent_message = service.users().messages().send(
            userId='me', 
            body=message_object
        ).execute()
        
        print(f"Monthly invoice email sent successfully to {user_email}")
        
        return True
    
    except Exception as e:
        print(f"Error sending monthly invoice email: {str(e)}")
        traceback.print_exc()
        return False

# Enhanced webhook handler to process monthly invoice payments
@app.route('/stripe-webhook', methods=['POST'])
def stripe_webhook():
    """Handle Stripe webhook events - invoice.paid for both individual and monthly invoices"""
    payload = request.get_data(as_text=True)
    sig_header = request.headers.get('Stripe-Signature')
    STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET')
    
    try:
        # Verify webhook signature
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
        print("✅ Received event:", event['type'])
        
        if event['type'] != 'invoice.paid':
            print("ℹ️ Ignored event type:", event['type'])
            return jsonify({'status': 'ignored'}), 200
        
        invoice = event['data']['object']
        print("📄 Invoice object:", invoice)
        
        # Check if this is a monthly invoice
        metadata = invoice.get('metadata', {})
        user_id = metadata.get('user_id')
        month = metadata.get('month')
        year = metadata.get('year')
        request_ids = metadata.get('request_ids')
        
        if user_id and month and year:
            # This is a monthly invoice
            print(f"📅 Processing monthly invoice payment for user {user_id}, {month}/{year}")
            
            try:
                with pool.connect() as conn:
                    with conn.begin():
                        # Update monthly invoice status
                        update_query = sqlalchemy.text("""
                        UPDATE public.monthly_invoice 
                        SET paid = TRUE, 
                            updated_at = CURRENT_TIMESTAMP
                        WHERE user_id = :user_id 
                        AND invoice_month = :month 
                        AND invoice_year = :year
                        """)
                        
                        result = conn.execute(update_query, {
                            "user_id": user_id,
                            "month": int(month),
                            "year": int(year)
                        })
                        
                        print(f"✅ Monthly invoice updated for user {user_id}, rows affected: {result.rowcount}")
                        
                        # Update all unpaid rental requests for this user
                        if request_ids:
                            request_id_list = [int(id) for id in request_ids.split(',')]
                            
                            update_requests_query = sqlalchemy.text("""
                            UPDATE public.rental_request 
                            SET paid = TRUE 
                            WHERE request_id = ANY(:request_ids)
                            """)
                            
                            req_result = conn.execute(update_requests_query, {
                                "request_ids": request_id_list
                            })
                            
                            print(f"✅ Updated {req_result.rowcount} rental requests to paid status")
                
                return jsonify({'status': 'success', 'type': 'monthly_invoice'}), 200
            
            except Exception as db_error:
                print("❌ Database error processing monthly invoice:", db_error)
                traceback.print_exc()
                return jsonify({'error': str(db_error)}), 500
        
        else:
            # This is an individual invoice
            request_id = metadata.get('request_id')
            if not request_id:
                print("⚠️ No request_id or user_id in invoice metadata")
                return jsonify({'status': 'no metadata identifier'}), 200
            
            try:
                with pool.connect() as conn:
                    with conn.begin():
                        update_query = sqlalchemy.text(
                            "UPDATE public.rental_request SET paid = TRUE WHERE request_id = :request_id"
                        )
                        result = conn.execute(update_query, {"request_id": request_id})
                        print(f"✅ DB updated for request_id={request_id}, rows affected: {result.rowcount}")
            except Exception as db_error:
                print("❌ Database error:", db_error)
                return jsonify({'error': str(db_error)}), 500
        
        return jsonify({'status': 'success', 'type': 'individual_invoice'}), 200
    
    except (stripe.error.SignatureVerificationError, ValueError) as e:
        print("❌ Signature verification error:", e)
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print("❌ Unexpected error:", e)
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# API endpoint to view monthly invoices for admin
@app.route('/api/admin/monthly_invoices', methods=['GET'])
def get_monthly_invoices():
    """Get all monthly invoices for admin view"""
    try:
        with pool.connect() as conn:
            query = sqlalchemy.text("""
            SELECT 
                mi.invoice_id,
                mi.user_id,
                CONCAT(r.first_name, ' ', r.last_name) as user_name,
                r.renter_email as user_email,
                mi.invoice_month,
                mi.invoice_year,
                TO_CHAR(TO_DATE(mi.invoice_month::text, 'MM'), 'Month') as month_name,
                mi.amount,
                mi.payment_link,
                mi.paid,
                mi.created_at,
                mi.updated_at,
                COUNT(rr.request_id) as request_count
            FROM 
                public.monthly_invoice mi
            JOIN 
                public.renter r ON mi.user_id = r.renter_id
            LEFT JOIN 
                public.rental_request rr ON r.renter_id = rr.user_id AND 
                rr.rental_status = 'approved' AND 
                (rr.paid = (mi.paid = TRUE))
            GROUP BY 
                mi.invoice_id, r.renter_id, r.first_name, r.last_name, r.renter_email
            ORDER BY 
                mi.invoice_year DESC, mi.invoice_month DESC, mi.created_at DESC
            """)
            
            # Convert RowMapping to dictionary for JSON serialization
            def row_to_dict(row):
                return {key: value for key, value in row._mapping.items()}
            
            invoices = [row_to_dict(row) for row in conn.execute(query)]
            
            return jsonify({
                "invoices": invoices,
                "count": len(invoices),
                "success": True
            })
    
    except Exception as e:
        print(f"Error fetching monthly invoices: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
