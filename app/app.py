from flask import Flask, render_template, request, jsonify 
from google.cloud.sql.connector import Connector
import sqlalchemy
import os
from datetime import datetime, timedelta
import pg8000
from dotenv import load_dotenv

load_dotenv('.env')

# Set credentials for Google Cloud SQL
credential_path = "cloud.json"
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credential_path

app = Flask(__name__)

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

@app.route('/')
def home():
    """Render the main calendar page"""
    return render_template('homepage.html')

@app.route('/u')
def u():
    """Render the main calendar page"""
    return render_template('userrequest.html')

@app.route('/signup')
def signup():
    """Render the signup page"""
    return render_template('signup.html')

@app.route("/resetpassword")
def reset_password():
    """Render the reset password page"""
    return render_template("resetpassword.html")


@app.route('/api/register', methods=['POST'])
def register_user():
    """Register a new user in the database"""
    try:
        data = request.get_json()
        
        required_fields = ['first_name', 'last_name', 'renter_email', 'phone', 'firebase_uid']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400
        
        with pool.connect() as conn:
            # Check if user already exists
            check_query = sqlalchemy.text("""
                SELECT renter_id FROM ice.renter 
                WHERE renter_email = :email OR firebase_uid = :uid
            """)
            existing_user = conn.execute(
                check_query,
                {"email": data['renter_email'], "uid": data['firebase_uid']}
            ).fetchone()
            
            if existing_user:
                return jsonify({"error": "User already exists"}), 409
            
            # Insert new user
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
                    "email": data['renter_email'],
                    "phone": data['phone'],
                    "uid": data['firebase_uid']
                }
            )
            conn.commit()
            
            return jsonify({"message": "User registered successfully", "renter_id": result.fetchone()[0]})
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500



@app.route('/api/user_profile/<firebase_uid>')
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

@app.route('/api/submit_request', methods=['POST'])
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

@app.route('/api/user_requests/<firebase_uid>')
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
                    TO_CHAR(request_date, 'MM/DD/YYYY HH12:MI AM') as request_date,
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
                    TO_CHAR(request_date, 'MM/DD/YYYY HH12:MI AM') as request_date,
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
                    TO_CHAR(request_date, 'MM/DD/YYYY HH12:MI AM') as request_date,
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

@app.route('/api/delete_request/<request_id>', methods=['DELETE'])
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
            
            admin_events = conn.execute(
                admin_query,
                {"start": start_date, "end": end_date}
            ).mappings().all()
            
            # Combine and process recurring events
            all_events = process_recurring_events(
                rentals + admin_events,
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
