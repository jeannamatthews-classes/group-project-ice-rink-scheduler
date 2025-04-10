from flask import Flask, render_template
from google.cloud.sql.connector import Connector
import sqlalchemy
import os
from datetime import datetime, timedelta
import pg8000

from dotenv import load_dotenv
load_dotenv()

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
