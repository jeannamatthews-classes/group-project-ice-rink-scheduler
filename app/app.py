from flask import Flask, render_template, request, jsonify
from google.cloud.sql.connector import Connector
from google.cloud.sql.connector.instance import IPTypes
from flask_bcrypt import Bcrypt
import os
from datetime import datetime, timedelta
import pg8000
import sqlalchemy
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(dotenv_path="app/env/.env")

# Database configuration
INSTANCE_CONNECTION_NAME = os.environ["INSTANCE_CONNECTION_NAME"]
DB_USER = os.environ["DB_USER"]
DB_PASS = os.environ["DB_PASS"]
DB_NAME = os.environ["DB_NAME"]

# Initialize the connector
connector = Connector()
def get_db_connection():
    """Returns a database connection."""
    return connector.connect(
        INSTANCE_CONNECTION_NAME,
        "pg8000",
        user=DB_USER,
        password=DB_PASS,
        db=DB_NAME,
        ip_type=IPTypes.PUBLIC  # Changed from "PUBLIC" to IPTypes.PUBLIC
    )

# Create connection pool using SQLAlchemy
pool = sqlalchemy.create_engine(
    "postgresql+pg8000://",
    creator=get_db_connection,
    pool_size=5,
    max_overflow=2,
    pool_timeout=30,
    pool_recycle=1800
)

# Initialize Flask app
app = Flask(
    __name__,
    template_folder=os.path.join(os.getcwd(), 'app/templates'),
    static_folder=os.path.join(os.getcwd(), 'app/static/js')
)

# Initialize bcrypt
bcrypt = Bcrypt(app)

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/user_view')
def user_view():
    return render_template('user_view.html')

@app.route('/userrequest')
def userrequest():
    return render_template('userrequest.html')

@app.route('/home page')
def home_page():
    return render_template('home page.html')

@app.route('/admin calendar')
def admin_calendar():
    return render_template('admin_calendar_page.html')

@app.route('/admin UI')
def admin_UI():
    return render_template('admin_UI_page.html')

@app.route('/signup', methods=['GET'])
def show_signup_form():
    return render_template('signup.html')

@app.route('/signup', methods=['POST'])
def signup():
    try:
        # Debug print the form data
        print("Form data received:", request.form)
        
        # Extract form data - this is where the error might be happening
        name = request.form.get('name', '')
        email = request.form.get('email', '')
        phone_number = request.form.get('phone-number', '')
        password = request.form.get('password', '')
        
        # Check if data was properly extracted
        print(f"Extracted values - Name: {name}, Email: {email}, Phone: {phone_number}")
        
        # Optional validation for phone number length
        if len(phone_number) not in [10, 11]:
            return jsonify({'error': 'Invalid phone number'}), 400

        # Encrypt the password
        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')

        with pool.connect() as conn:
            # Check if the email already exists
            check_email_query = "SELECT COUNT(*) FROM ice.users WHERE email = %s"
            result = conn.execute(check_email_query, (email,)).fetchone()

            if result[0] > 0:
                return jsonify({'error': 'Email already exists'}), 400

            # Insert the user into the database
            query = """
                INSERT INTO ice.users (name, email, phone_number, password)
                VALUES (%s, %s, %s, %s)
            """
            conn.execute(query, (name, email, phone_number, hashed_password))

            # Return JSON response for API consistency
            return jsonify({'success': True, 'message': 'Account created successfully!'})

    except Exception as e:
        print(f"Error in signup: {str(e)}")
        import traceback
        traceback.print_exc()  # Print full traceback
        return jsonify({'error': str(e)}), 500

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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)