## HubSpot "Healers" Appointment Serverless Function

This function acts as a middleman for booking "Custom Object Healers" appointments in HubSpot. It accepts inputs from a frontend (e.g., Sage AI) and uses OAuth 2.0 (or a Private App Token fallback) to fetch or create a HubSpot custom object record.

### Inputs
- **meeting**: string (format YYYY-MM-DD)
- **languages**: string (comma-separated, e.g., "English, Spanish")

### HubSpot API Interaction
- **Search (GET)**: Uses CRM v3 custom object search: `POST https://api.hubapi.com/crm/v3/objects/{objectType}/search`
  - Filters by the configured properties for `meeting` and `languages`.
- **Create (POST)**: Creates a custom object record: `POST https://api.hubapi.com/crm/v3/objects/{objectType}`
- **Auth**: OAuth 2.0 access token via `HUBSPOT_ACCESS_TOKEN` or Private App Token via `HUBSPOT_PRIVATE_APP_TOKEN`.
- **Property mapping**: Maps inputs to the configured custom object properties via env vars.

Note: If you wish to fetch by object ID directly, you can use `GET https://api.hubapi.com/crm/v3/objects/{objectType}/{objectId}`. This function currently supports search (GET) and create (POST) flows.

### Environment Variables
Set these in Vercel Project Settings → Environment Variables:

```
HUBSPOT_ACCESS_TOKEN=                        # OAuth 2.0 token
HUBSPOT_MEETING_PROP=meeting                 # Optional override
HUBSPOT_LANGUAGES_PROP=languages             # Optional override
```

Do not commit real tokens to source control. Use your platform's secrets manager.

### File Structure
- `api/book-appointment.js`: Vercel Edge-compatible handler (runtime edge)

### Running Locally
This file is implemented as a fetch-style handler for serverless platforms. For local testing, deploy to an environment like Vercel/Netlify/Cloudflare which natively invokes the handler. If you need a local HTTP server, wrap `handleRequest` in a small server (Express/Node HTTP) as desired.

### Deployment Notes
- Vercel: push to GitHub, import the repo in Vercel. It will auto-detect `api/book-appointment.js`. Set env vars and deploy.

### Usage

GET (search):
```bash
curl -G \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" \
  --data-urlencode "meeting=2025-10-10" \
  --data-urlencode "languages=English, Spanish" \
  https://your-deployment.example.com/api/book-appointment
```

POST (create):
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" \
  -d '{"meeting":"2025-10-10","languages":"English, Spanish"}' \
  https://your-deployment.example.com/api/book-appointment
```

### Response Format
- Success: `{ "status": "success", "message": "Appointment booked successfully" }` (create)
- Error: `{ "status": "error", "message": "<HubSpot error message>" }`

On GET search success, the function returns `{ status: "success", message: "Fetched appointments", data: { ...HubSpot search results... } }`.


