# Terp Path

An unofficial UMD degree and schedule planner. CS general-track pilot; no AI, accounts, or registration automation.

## Development

Use Node 22+ and Python 3.13.

```sh
npm ci
python3.13 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
.venv/bin/uvicorn server.app.main:app --reload --port 8011
# In another terminal:
npm run dev
```

The UI runs at http://localhost:5173; the API and interactive schema at http://127.0.0.1:8011/docs.

```sh
npm test
npm run build
.venv/bin/python -m pytest server/tests
```

Raw PDFs remain in-browser. Student profiles are saved locally; reviewed academic data is sent to a stateless solver. Do not commit personal audits or extracted student data.
