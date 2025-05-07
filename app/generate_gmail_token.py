import os
import json
from google_auth_oauthlib.flow import InstalledAppFlow
from dotenv import set_key

# Settings
SCOPES = ['https://www.googleapis.com/auth/gmail.send']
CREDENTIALS_FILE = 'credentials.json'
ENV_FILE = '.env.gmail'
TOKEN_ENV_VAR = 'GMAIL_TOKEN'

def save_token_to_env(token_json):
    # Directly save the token JSON as a string in the .env file
    set_key(ENV_FILE, TOKEN_ENV_VAR, token_json)
    print(f"✅ Token saved to {ENV_FILE} as {TOKEN_ENV_VAR}")

def generate_gmail_token():
    if not os.path.exists(CREDENTIALS_FILE):
        print(f"❌ Missing {CREDENTIALS_FILE}")
        return

    try:
        flow = InstalledAppFlow.from_client_secrets_file(
            CREDENTIALS_FILE, SCOPES)
        creds = flow.run_local_server(port=8080, access_type='offline', prompt='consent')
        print("🔐 Authentication successful.")
        token_json = creds.to_json()  # This is already in the correct format (JSON string)
        save_token_to_env(token_json)  # Save it directly as a string
    except Exception as e:
        print(f"❌ Authentication failed: {e}")

if __name__ == '__main__':
    generate_gmail_token()

