from flask import Flask, render_template, request, jsonify, redirect, Blueprint 
import json
from google.cloud.sql.connector import Connector
import sqlalchemy
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
import stripe

# Initialize Firebase Admin SDK (only once)
if not firebase_admin._apps:
    cred = credentials.Certificate("icerinkscheduling-firebase-adminsdk-fbsvc-97323839f3.json")
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
CREDENTIALS_FILE = 'credentials.json' # Your OAuth client secrets file
TOKEN_FILE = 'token.json' # File to store the user's access and refresh tokens
gmail_service = None

def get_gmail_service():
    global gmail_service

    if gmail_service:
        return gmail_service

    creds = None
    if os.path.exists(TOKEN_FILE):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
        except Exception as e:
            print(f"Error loading credentials: {e}")
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                print("Access token refreshed.")
                with open(TOKEN_FILE, 'w') as token:
                    token.write(creds.to_json())
            except Exception as e:
                print(f"Failed to refresh token: {e}")
                creds = None

        if not creds:
            # Full re-authentication needed
            if not os.path.exists(CREDENTIALS_FILE):
                print(f"Missing credentials file: {CREDENTIALS_FILE}")
                return None

            try:
                flow = InstalledAppFlow.from_client_secrets_file(
                    CREDENTIALS_FILE, SCOPES
                )
                creds = flow.run_local_server(
                    port=8080,
                    access_type='offline',
                    prompt='consent'
                )
                with open(TOKEN_FILE, 'w') as token:
                    token.write(creds.to_json())
                print("New credentials obtained and saved.")
            except Exception as e:
                print(f"Error during re-authentication: {e}")
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
                    query = sqlalchemy.text("SELECT 1 FROM ice.admin WHERE email = :email")
                    result = conn.execute(query, {"email": user_email}).fetchone()
                    is_admin = result is not None

                if not is_admin:
                    print(f"Access Denied: '{user_email}' is not in ice.admin")
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
            query = sqlalchemy.text("SELECT 1 FROM ice.admin WHERE email = :email")
            result = conn.execute(query, {"email": user_email}).fetchone()
            is_admin = result is not None
            print(f"Querying ice.admin for '{user_email}', found: {is_admin}")
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
                SELECT renter_id FROM ice.renter 
                WHERE renter_email = :email OR firebase_uid = :uid
            """)
            existing_user = conn.execute(check_query, {"email": email, "uid": firebase_uid}).fetchone()

            if existing_user:
                return jsonify({"error": "User already exists"}), 409

            # Insert new verified user
            insert_query = sqlalchemy.text("""
                INSERT INTO ice.renter 
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
            conn.commit()

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
                FROM ice.renter 
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
                FROM ice.rental_request
                INNER JOIN ice.renter ON ice.rental_request.user_id = renter.renter_id
                WHERE renter.firebase_uid = :firebase_uid
                AND rental_status IN ('pending', 'approved')
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
        
        with pool.connect() as conn:
            # Get user_id from firebase_uid
            user_query = sqlalchemy.text("""
                SELECT renter_id FROM ice.renter 
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
                INSERT INTO ice.rental_request 
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
            conn.commit()
            
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
        
        with pool.connect() as conn:
            # Get user_id from firebase_uid
            user_query = sqlalchemy.text("""
                SELECT admin_id FROM ice.admin
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
                INSERT INTO ice.admin_event 
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
            conn.commit()
            
            return jsonify({
                "message": "Request submitted successfully",
                "request_id": result.fetchone()[0]
            })
            
    except Exception as e:
        print("Error submitting request:", str(e))
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
                SELECT renter_id FROM ice.renter 
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
                FROM ice.rental_request
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
                FROM ice.rental_request
                WHERE user_id = :user_id 
                AND rental_status = 'approved'
                ORDER BY start_date, start_time
            """)
            
            accepted = [row_to_dict(row) for row in conn.execute(
                accepted_query,
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
                FROM ice.rental_request
                WHERE user_id = :user_id 
                AND rental_status = 'denied'
                ORDER BY start_date, start_time
            """)
            
            declined = [row_to_dict(row) for row in conn.execute(
                declined_query,
                {"user_id": user_id}
            )]
            
            return jsonify({
                "requests": pending + accepted + declined
            })
            
    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error fetching requests for {firebase_uid}: {str(e)}")
        return jsonify({"error": "Database error occurred"}), 500
    except Exception as e:
        print(f"Unexpected error fetching requests for {firebase_uid}: {str(e)}")
        return jsonify({"error": "An unexpected error occurred"}), 500

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
                FROM ice.admin_event
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
                    rr.declined_reason,
                    r.renter_email as user_email,
                    CONCAT(r.first_name, ' ', r.last_name) as user_name,
                    r.phone as user_phone
                FROM ice.rental_request rr
                JOIN ice.renter r ON rr.user_id = r.renter_id
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

@app.route('/api/admin/events/delete/<event_id>', methods=['DELETE'])
@require_admin(pool)
def delete_admin_event(event_id):
    """Delete an admin event"""
    try:
        with pool.connect() as conn:
            # Delete the event
            delete_query = sqlalchemy.text("""
                DELETE FROM ice.admin_event
                WHERE event_id = :event_id
                RETURNING event_id
            """)
            
            result = conn.execute(
                delete_query,
                {"event_id": event_id}
            ).fetchone()
            
            if not result:
                return jsonify({"error": "Event not found"}), 404
                
            conn.commit()
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
                UPDATE ice.admin_event
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

            conn.commit()
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
    """Approve a rental request and set an amount"""
    try:
        data = request.get_json() or {}
        amount = data.get('amount')  # Get amount from request body
        
        with pool.connect() as conn:  # Establishing the connection here
            # Update the request status and amount
            update_query = sqlalchemy.text(""" 
                UPDATE ice.rental_request
                SET rental_status = 'approved', 
                    approved_date = NOW(),
                    amount = :amount
                WHERE request_id = :request_id
                RETURNING request_id
            """)
            
            result = conn.execute(
                update_query,
                {
                    "request_id": request_id,
                    "amount": amount if amount is not None else None
                }
            )
            conn.commit()

        return jsonify({
            "message": "Request approved successfully",
            "request_id": request_id
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


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
                UPDATE ice.rental_request
                SET amount = :amount
                WHERE request_id = :request_id
                AND rental_status = 'approved'
                RETURNING request_id
            """)
            
            result = conn.execute(
                update_query,
                {
                    "request_id": request_id,
                    "amount": amount
                }
            )
            conn.commit()

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
                UPDATE ice.admin_event
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
            conn.commit()

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
        
@app.route('/api/admin/decline_request/<request_id>', methods=['POST'])
@require_admin(pool)
def decline_request(request_id):
    """Admin declines a rental request with a reason"""
    reason = request.json.get('reason', '')
    
    if not reason:
        return jsonify({"error": "Reason is required"}), 400
        
    try:
        with pool.connect() as conn:
            # Update request status to declined with reason and decision date
            update_query = sqlalchemy.text("""
                UPDATE ice.rental_request
                SET rental_status = 'denied',
                    declined_reason = :reason,
                    status_change_date = CURRENT_TIMESTAMP
                WHERE request_id = :request_id
                RETURNING request_id
            """)
            
            result = conn.execute(
                update_query,
                {"request_id": request_id, "reason": reason}
            ).fetchone()
            
            if not result:
                return jsonify({"error": "Request not found"}), 404
                
            conn.commit()
            return jsonify({
                "success": True,
                "message": "Request declined successfully",
                "request_id": request_id
            })
            
    except sqlalchemy.exc.SQLAlchemyError as e:
        print(f"Database error declining request {request_id}: {str(e)}")
        return jsonify({"error": "Database error occurred"}), 500
    except Exception as e:
        print(f"Unexpected error declining request {request_id}: {str(e)}")
        return jsonify({"error": "An unexpected error occurred"}), 500

@app.route('/api/delete_request/<request_id>', methods=['DELETE'])
@require_authentication
def delete_request(request_id):
    """Delete a specific request"""
    try:
        with pool.connect() as conn:
            # Verify the request exists and belongs to the user
            verify_query = sqlalchemy.text("""
                SELECT rr.user_id 
                FROM ice.rental_request rr
                JOIN ice.renter r ON rr.user_id = r.renter_id
                WHERE rr.request_id = :request_id
            """)
            result = conn.execute(verify_query, {"request_id": request_id}).fetchone()
            
            if not result:
                return jsonify({"error": "Request not found"}), 404
                
            # Delete the request
            delete_query = sqlalchemy.text("""
                DELETE FROM ice.rental_request
                WHERE request_id = :request_id
            """)
            conn.execute(delete_query, {"request_id": request_id})
            
            # Commit the transaction to make it persistent
            conn.commit()
            
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
                FROM ice.rental_request 
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
                FROM ice.admin_event
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
                
        elif event['recurrence_rule'] == 'monthly':
            original_day = current_date.day
            while current_date <= end_date_recur:
                # Handle month boundaries
                next_month = (current_date.replace(day=1) + timedelta(days=32)).replace(day=1)
                last_day_of_month = next_month - timedelta(days=1)
                event_day = min(original_day, last_day_of_month.day)
                
                event_date = current_date.replace(day=event_day)
                processed_events.append(format_event(event, event_date))
                
                # Move to next month
                try:
                    current_date = current_date.replace(day=1) + timedelta(days=32)
                    current_date = current_date.replace(day=original_day)
                except ValueError:
                    current_date = (current_date.replace(day=1) + timedelta(days=63)).replace(day=1) - timedelta(days=1)
    
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
                UPDATE ice.renter
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
                
            conn.commit()
            
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

        # Check if there's already a payment link or invoice for this request
        with pool.connect() as conn:
            check_query = sqlalchemy.text(
                """
                SELECT 
                    payment_link,
                    paid
                FROM ice.rental_request 
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
            # 1. Create a Customer (or you can look up existing by email if you want)
            customer = stripe.Customer.create(
                email=user_email,
                metadata={"request_id": str(request_id)}
            )

            # 2. Create Invoice Item
            stripe.InvoiceItem.create(
                customer=customer.id,
                amount=int(amount * 100),  # Amount in cents
                currency='usd',
                description=f'Rental: {rental_name} ({start_date} to {end_date})'
            )

            # 3. Create Invoice
            invoice = stripe.Invoice.create(
                customer=customer.id,
                collection_method='send_invoice',
                days_until_due=7,  # Due in 7 day
                metadata={"request_id": str(request_id)}
            )

            # 4. Finalize the Invoice
            finalized_invoice = stripe.Invoice.finalize_invoice(invoice.id)

            payment_link = finalized_invoice.hosted_invoice_url

            # Update DB with payment link and invoice id
            with pool.connect() as conn:
                update_query = sqlalchemy.text(
                    """
                    UPDATE ice.rental_request 
                    SET payment_link = :payment_link
                    WHERE request_id = :request_id
                    """
                )
                conn.execute(update_query, {
                    "payment_link": payment_link,
                    "request_id": request_id
                })
                conn.commit()

            print(f"Created new invoice for request {request_id}")

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
            <p>If you have any questions, please contact us.</p>
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


@app.route('/stripe-webhook', methods=['POST'])
def stripe_webhook():
    """Handle Stripe webhook events for payment status updates"""
    payload = request.get_data(as_text=True)
    sig_header = request.headers.get('Stripe-Signature')
    
    try:
        # Verify webhook signature
        event = stripe.Webhook.construct_event(
            payload, sig_header, STRIPE_WEBHOOK_SECRET
        )
        
        # Handle checkout.session.completed event
        if event['type'] == 'checkout.session.completed':
            session = event['data']['object']
            
            # Get request_id from metadata
            request_id = session.get('metadata', {}).get('request_id')
            if not request_id:
                request_id = session.get('client_reference_id')
            
            if request_id:
                # Update payment status in database
                with pool.connect() as conn:
                    update_query = sqlalchemy.text(
                        "UPDATE ice.rental_request SET paid = TRUE WHERE request_id = :request_id"
                    )
                    conn.execute(update_query, {"request_id": request_id})
                    conn.commit()
                    print(f"Payment marked as paid for request_id: {request_id}")
            else:
                print("Warning: No request_id found in the webhook data")
                
        return jsonify({'status': 'success'})
    
    except (stripe.error.SignatureVerificationError, ValueError) as e:
        print(f"Webhook error: {str(e)}")
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Webhook error: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
