# HealthGuard AI v4.1 — Professional Medical Intelligence Platform

## 🚀 Quick Start
```bash
npm install
cp .env.example .env
# Add your OPENAI_API_KEY to .env
npm start
# Open http://localhost:3000
```

## ✨ New Features in v4.1

### Frontend
- **Modern medical-grade UI** — Clean light theme with teal/blue accents
- **Symptom Autocomplete** — Real-time suggestions as you type
- **Voice Input** — Microphone symptom entry (English & Tamil)
- **Quick Select Grid** — Toggle common symptoms with one click
- **Disease Probability Chart** — Chart.js horizontal bar chart
- **Prediction History** — LocalStorage + server-side history panel
- **PDF Report Download** — Full medical report as HTML/PDF
- **AI Clinical Explanation** — Claude-powered disease explanations
- **Dark Mode Toggle** — System-aware theme switching
- **Multi-Language** — English & Tamil support throughout
- **Health Risk Indicator** — Color-coded green/yellow/red/emergency
- **Loading Animations** — Professional pulse ring loading overlay
- **Responsive Design** — Mobile-first layout

### Backend (server.js)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analyze` | POST | Symptom analysis (OpenAI → Smart Triage fallback) |
| `/api/explain` | POST | AI clinical explanation for a condition |
| `/api/history` | GET | Server-side prediction history |
| `/api/health` | GET | Server + AI status |
| `/api/symptoms` | GET | Symptom database (EN/TA) |
| `/api/stats` | GET | Analytics & model metrics |
| `/api/provider` | GET | Active AI provider config |

## 🏗️ Project Structure
```
├── frontend/
│   ├── index.html      ← Main app shell
│   ├── styles.css      ← Full CSS with dark mode & responsive
│   └── app.js          ← Complete feature JS
├── backend/
│   └── server.js       ← Express API with all endpoints
├── data/
│   └── symptoms.json   ← Symptom database (EN/TA/HI)
└── .env.example        ← Configuration template
```

## ⚕️ Disclaimer
This is an AI-assisted tool for informational purposes only. Not a substitute for professional medical advice.

## 👨‍💻 Developer Details
**Sivaraj T**
* **Role:** Full-Stack Developer & ML Logic
* **Education:** B.Tech Information Technology, Velammal Engineering College
* **Location:** Tiruvannamalai / Chennai, Tamil Nadu
* **Skills:** Java, Python, Flask, SQL, MongoDB, C
* **Achievements:** 2nd Place at VEC 24-Hour Hackathon (March 2026); 1500+ problems solved on SkillRack.
