// ═══════════════════════════════════════════════════════════════════════════════
// HealthGuard AI — Backend Server v4.1 (Enhanced)
// Endpoints: /api/health, /api/analyze, /api/explain, /api/history,
//            /api/provider, /api/symptoms, /api/test-openai
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const https        = require('https');
const { execFile } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Banner ───────────────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🏥  HealthGuard AI v4.2 — Starting...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Load local data ──────────────────────────────────────────────────────────
const symptomsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/symptoms.json'), 'utf8')
);

// ─── In-memory prediction history (server-side) ───────────────────────────────
const predictionHistory = [];
const MAX_HISTORY = 100;

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
const CONFIG = {
  provider:       (process.env.AI_PROVIDER      || 'openai').toLowerCase().trim(),
  timeoutMs:       parseInt(process.env.AI_TIMEOUT_MS  || '12000'),
  maxTokens:       parseInt(process.env.AI_MAX_TOKENS   || '700'),
  fallbackOnError: process.env.FALLBACK_ON_AI_ERROR !== 'false',
  openai: {
    apiKey: (process.env.OPENAI_API_KEY || '').trim(),
    model:  (process.env.OPENAI_MODEL   || 'gpt-4o-mini').trim(),
    url:    'https://api.openai.com/v1/chat/completions',
  },
  claude: {
    apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
    model:  (process.env.CLAUDE_MODEL      || 'claude-haiku-4-5-20251001').trim(),
    url:    'https://api.anthropic.com/v1/messages',
  },
  gemini: {
    apiKey: (process.env.GEMINI_API_KEY || '').trim(),
    model:  (process.env.GEMINI_MODEL   || 'gemini-1.5-flash').trim(),
  },
};

console.log(`🤖  Provider: ${CONFIG.provider.toUpperCase()}`);
console.log(`    Key set : ${CONFIG.openai.apiKey ? '✅' : '❌ fallback active'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function httpsPost(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    };
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`Timeout after ${timeoutMs}ms`)); }, timeoutMs);
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', err => { clearTimeout(timer); reject(err); });
    req.write(bodyStr);
    req.end();
  });
}

function parseAIResponse(rawText) {
  if (!rawText?.trim()) throw new Error('Empty AI response');
  let clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in response');
  return normalizeAIResult(JSON.parse(clean.slice(start, end + 1)));
}

function normalizeAIResult(obj) {
  const VALID_RISKS = ['low', 'medium', 'high', 'emergency'];
  const rawRisk = ((obj.riskLevel || obj.risk || 'low')).toString().toLowerCase().trim();
  const risk    = VALID_RISKS.includes(rawRisk) ? rawRisk : 'low';
  const advice  = (typeof obj.medicalAdvice === 'string' && obj.medicalAdvice.trim()) ||
                  (typeof obj.advice        === 'string' && obj.advice.trim())        ||
                  'Please consult a qualified healthcare professional.';

  let conditions;
  if (Array.isArray(obj.possibleConditions) && obj.possibleConditions.length > 0) {
    conditions = obj.possibleConditions.map(c => ({ name: String(c.name || 'Unknown'), risk: (c.risk || 'low').toLowerCase() }));
  } else if (Array.isArray(obj.conditions) && obj.conditions.length > 0) {
    conditions = obj.conditions.map(c => ({ name: String(c.name || c.condition || 'Unknown'), risk: (c.risk || 'low').toLowerCase() }));
  } else {
    conditions = [{ name: obj.condition || 'General Health Concern', risk }];
  }

  return {
    symptoms:           Array.isArray(obj.symptoms) ? obj.symptoms.map(String) : [],
    condition:          typeof obj.condition === 'string' ? obj.condition.trim() : 'General Health Concern',
    conditions,
    possibleConditions: conditions,
    risk,
    riskLevel:          risk,
    advice,
    medicalAdvice:      advice,
    emergencyWarning:   typeof obj.emergencyWarning === 'string' ? obj.emergencyWarning.trim() : '',
    isEmergency:        obj.isEmergency === true || risk === 'emergency',
    confidence:         obj.confidence || 'Medium',
    source:             'ai',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

function buildAnalysisPrompt(symptomText, language) {
  const langName = language === 'ta' ? 'Tamil' : language === 'hi' ? 'Hindi' : 'English';
  return `You are an experienced clinical AI assistant for healthcare in India.
A patient has described their symptoms. Analyze everything provided — including duration, medication, severity, and other context — and respond ONLY with valid JSON (no markdown, no code fences).

Use ALL provided context (duration, medication taken, severity, trends) to improve accuracy.
If patient already took medication but still has symptoms, factor that into your assessment.

Required JSON format:
{
  "symptoms": ["extracted", "symptom", "list"],
  "condition": "Most likely primary diagnosis",
  "possibleConditions": [
    { "name": "Condition 1", "risk": "Low|Medium|High|Emergency" },
    { "name": "Condition 2", "risk": "Low|Medium|High|Emergency" },
    { "name": "Condition 3", "risk": "Low|Medium|High|Emergency" }
  ],
  "riskLevel": "Low|Medium|High|Emergency",
  "medicalAdvice": "Practical advice in ${langName} considering their specific situation. 2-3 sentences.",
  "emergencyWarning": "",
  "isEmergency": false,
  "confidence": "Low|Medium|High"
}

Risk guidelines:
- Emergency: chest pain + breathlessness, fainting, signs of stroke, severe allergic reaction
- High: high fever >103°F, severe pain, blood in stool/vomit, symptoms not responding to medication
- Medium: flu, food poisoning, UTI, moderate fever, symptoms persisting >3 days despite medication
- Low: common cold, mild headache, mild stomach upset, symptoms improving

Adjust confidence based on completeness of information provided.
If Tamil language, write medicalAdvice in Tamil.

Patient information: "${symptomText}"`;
}

function buildExplainPrompt(condition, symptoms, risk, language) {
  const langName = language === 'ta' ? 'Tamil' : 'English';
  return `You are a compassionate clinical AI. Explain this medical situation in ${langName}:

Condition: ${condition}
Symptoms: ${symptoms.join(', ')}
Risk Level: ${risk}

Respond in ${langName} with sections:
**What is this condition?**
**Possible causes**
**Recommended precautions**
**When to see a doctor**

Keep it clear and suitable for patients. No excessive jargon.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI PROVIDERS
// ═══════════════════════════════════════════════════════════════════════════════

async function analyzeSymptomsWithOpenAI(text, language = 'en') {
  const { apiKey, model, url } = CONFIG.openai;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const prompt = buildAnalysisPrompt(text, language);
  const resp = await httpsPost(url, { 'Authorization': `Bearer ${apiKey}` }, {
    model, temperature: 0.3, max_tokens: CONFIG.maxTokens,
    messages: [
      { role: 'system', content: 'Medical triage AI. Respond ONLY with valid JSON.' },
      { role: 'user', content: prompt }
    ]
  }, CONFIG.timeoutMs);
  if (resp.status !== 200) throw new Error(`OpenAI ${resp.status}: ${resp.body?.error?.message || JSON.stringify(resp.body).slice(0, 200)}`);
  return parseAIResponse(resp.body?.choices?.[0]?.message?.content);
}

async function explainWithOpenAI(condition, symptoms, risk, language) {
  const { apiKey, model, url } = CONFIG.openai;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const prompt = buildExplainPrompt(condition, symptoms, risk, language);
  const resp = await httpsPost(url, { 'Authorization': `Bearer ${apiKey}` }, {
    model, temperature: 0.5, max_tokens: 800,
    messages: [{ role: 'user', content: prompt }]
  }, CONFIG.timeoutMs);
  if (resp.status !== 200) throw new Error(`OpenAI explain ${resp.status}`);
  return resp.body?.choices?.[0]?.message?.content || '';
}

async function analyzeSymptomsWithClaude(text, language) {
  if (!CONFIG.claude.apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const resp = await httpsPost(CONFIG.claude.url,
    { 'x-api-key': CONFIG.claude.apiKey, 'anthropic-version': '2023-06-01' },
    { model: CONFIG.claude.model, max_tokens: CONFIG.maxTokens, messages: [{ role: 'user', content: buildAnalysisPrompt(text, language) }] },
    CONFIG.timeoutMs
  );
  if (resp.status !== 200) throw new Error(`Claude ${resp.status}`);
  return parseAIResponse(resp.body?.content?.[0]?.text || '');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART TRIAGE FALLBACK ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

const SYMPTOM_KEYWORDS = {
  fever: ['fever','temperature','feverish','pyrexia','body heat','காய்ச்சல்','வெப்பநிலை','बुखार'],
  headache: ['headache','head pain','head ache','migraine','throbbing head','தலைவலி','सिरदर्द'],
  vomiting: ['vomit','vomiting','throwing up','nausea','nauseous','puking','வாந்தி','குமட்டல்','उल्टी','मतली'],
  stomach_pain: ['stomach pain','abdominal pain','stomach ache','tummy pain','belly pain','வயிற்று வலி','पेट दर्द'],
  diarrhea: ['diarrhea','loose stools','loose motion','watery stool','வயிற்றுப்போக்கு','दस्त'],
  cough: ['cough','coughing','dry cough','wet cough','persistent cough','இருமல்','खांसी'],
  fatigue: ['fatigue','tired','tiredness','weakness','weak','exhausted','no energy','சோர்வு','களைப்பு','थकान','कमजोरी'],
  breathing_problem: ['breathing problem','shortness of breath','difficulty breathing','breathless','cant breathe','மூச்சு திணறல்','सांस लेने में तकलीफ'],
  chest_pain: ['chest pain','heart pain','pressure in chest','chest tightness','நெஞ்சு வலி','सीने में दर्द'],
  sore_throat: ['sore throat','throat pain','throat ache','scratchy throat','தொண்டை வலி','गले में दर्द'],
  dizziness: ['dizzy','dizziness','lightheaded','spinning','vertigo','தலைச்சுற்றல்','चक्कर'],
  fainting: ['faint','fainting','passed out','unconscious','மயக்கம்','बेहोशी'],
  body_ache: ['body ache','body pain','muscle pain','aching body','pain all over','joint pain','உடல் வலி','बदन दर्द'],
  cold: ['cold','common cold','runny nose','stuffy nose','blocked nose','sneezing','சளி','जुकाम'],
  rash: ['rash','skin rash','itching','itchy','hives','தோல் அரிப்பு','चकत्ते','खुजली'],
  back_pain: ['back pain','lower back pain','backache','spine pain','முதுகு வலி','कमर दर्द'],
};

const DISEASES = [
  { name: 'Possible Cardiac Emergency', name_ta: 'இதய அவசரநிலை', symptoms: ['chest_pain','breathing_problem','fainting'], risk: 'emergency', advice: { en: 'These symptoms may indicate a heart attack. Call 108 immediately. Do not drive yourself.', ta: '108 ஐ உடனடியாக அழையுங்கள்.' } },
  { name: 'Medical Emergency – Fainting', name_ta: 'மருத்துவ அவசரநிலை – மயக்கம்', symptoms: ['fainting','dizziness','fatigue'], risk: 'emergency', advice: { en: 'Fainting requires immediate attention. Lay flat, elevate legs. Call 108.', ta: '108 அழையுங்கள்.' } },
  { name: 'Respiratory Distress', name_ta: 'சுவாச கஷ்டம்', symptoms: ['breathing_problem','chest_pain','fatigue'], risk: 'high', advice: { en: 'Sit upright, stay calm. Call 108 if lips turn blue.', ta: 'நேராக உட்காருங்கள். உடனடி மருத்துவ உதவி பெறுங்கள்.' } },
  { name: 'Viral Fever', name_ta: 'வைரஸ் காய்ச்சல்', symptoms: ['fever','headache','fatigue','body_ache'], risk: 'medium', advice: { en: 'Rest, stay hydrated, take paracetamol. See doctor if fever > 103°F or lasts > 3 days.', ta: 'ஓய்வு எடுங்கள், நிறைய தண்ணீர் குடிக்கவும். 3 நாட்களுக்கு மேல் தொடர்ந்தால் மருத்துவரை சந்திக்கவும்.' } },
  { name: 'Food Poisoning', name_ta: 'உணவு நச்சேற்றம்', symptoms: ['vomiting','stomach_pain','diarrhea','fatigue'], risk: 'medium', advice: { en: 'Drink ORS. Avoid solid food 4-6 hours. See doctor if > 24 hours.', ta: 'ORS குடிக்கவும். 24 மணி நேரத்திற்கும் மேல் தொடர்ந்தால் மருத்துவரை சந்திக்கவும்.' } },
  { name: 'Possible Influenza (Flu)', name_ta: 'இன்ஃப்ளூயன்சா', symptoms: ['fever','cough','sore_throat','body_ache'], risk: 'medium', advice: { en: 'Rest, drink warm fluids, take paracetamol. Doctor if > 3 days.', ta: 'ஓய்வு எடுங்கள், வெதுவெதுப்பான திரவங்கள் குடிக்கவும்.' } },
  { name: 'Gastroenteritis', name_ta: 'வயிற்றுப் புண்', symptoms: ['stomach_pain','vomiting','diarrhea','fatigue'], risk: 'medium', advice: { en: 'Clear fluids, ORS. See doctor if > 2 days.', ta: 'ORS குடிக்கவும். 2 நாட்களுக்கு மேல் தொடர்ந்தால் மருத்துவரை சந்திக்கவும்.' } },
  { name: 'Migraine', name_ta: 'ஒற்றைத் தலைவலி', symptoms: ['headache','fatigue','dizziness','vomiting'], risk: 'low', advice: { en: 'Rest in dark quiet room. Cold compress on forehead. See doctor if frequent.', ta: 'இருண்ட அறையில் ஓய்வெடுங்கள்.' } },
  { name: 'Common Cold', name_ta: 'சாதாரண சளி', symptoms: ['cold','cough','sore_throat','fever'], risk: 'low', advice: { en: 'Rest, warm fluids, steam inhalation. Should resolve in 7-10 days.', ta: 'ஓய்வு, வெதுவெதுப்பான திரவங்கள், ஆவி.' } },
  { name: 'Tension Headache', name_ta: 'இறுக்க தலைவலி', symptoms: ['headache','fatigue','back_pain'], risk: 'low', advice: { en: 'Rest, hydrate. OTC pain relief may help. See doctor if severe/persistent.', ta: 'ஓய்வு, தண்ணீர் குடிக்கவும்.' } },
];

const EMERGENCY_CANONICAL = new Set(['chest_pain', 'breathing_problem', 'fainting']);

function detectLanguage(text) {
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  return 'en';
}

function extractSymptoms(text) {
  const normalized = text.toLowerCase().replace(/[.,!?;:'"()]/g, ' ').replace(/\s+/g, ' ').trim();
  const canonical = new Set();
  for (const [key, aliases] of Object.entries(SYMPTOM_KEYWORDS)) {
    for (const alias of aliases) {
      if (normalized.includes(alias.toLowerCase())) { canonical.add(key); break; }
    }
  }
  return Array.from(canonical);
}

function scoreSymptoms(symptoms) {
  const set = new Set(symptoms);
  return DISEASES
    .map(d => {
      const mc = d.symptoms.filter(s => set.has(s)).length;
      return { disease: d, matchCount: mc, score: mc * 2 + mc / d.symptoms.length };
    })
    .filter(s => s.matchCount > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function runLocalFallback(rawText, language) {
  const lang = language === 'ta' ? 'ta' : detectLanguage(rawText);
  const isTamil = lang === 'ta';
  const symptoms = extractSymptoms(rawText);
  const hasEmergency = symptoms.some(s => EMERGENCY_CANONICAL.has(s));
  const top = scoreSymptoms(symptoms);
  const best = top[0]?.disease || null;

  let risk = 'low';
  if (hasEmergency || top.some(c => c.disease.risk === 'emergency')) risk = 'emergency';
  else if (top.some(c => c.disease.risk === 'high')) risk = 'high';
  else if (top.some(c => c.disease.risk === 'medium')) risk = 'medium';

  const advice = best
    ? (isTamil ? (best.advice?.ta || best.advice?.en) : best.advice?.en)
    : 'Please describe symptoms in more detail or consult a healthcare professional.';

  const conditions = top.map(c => ({
    name: isTamil ? (c.disease.name_ta || c.disease.name) : c.disease.name,
    risk: c.disease.risk,
  }));

  return {
    symptoms: symptoms.map(s => s.replace(/_/g, ' ')),
    condition: best ? `Possible ${isTamil ? (best.name_ta || best.name) : best.name}` : 'General Health Concern',
    conditions,
    possibleConditions: conditions,
    risk,
    riskLevel: risk,
    advice,
    medicalAdvice: advice,
    emergencyWarning: (hasEmergency || risk === 'emergency') ? (isTamil ? '108 ஐ உடனடியாக அழையுங்கள்!' : 'Call 108 immediately!') : '',
    isEmergency: hasEmergency || risk === 'emergency',
    confidence: top.length > 0 ? (top[0].matchCount >= 3 ? 'High' : top[0].matchCount >= 2 ? 'Medium' : 'Low') : 'Low',
    source: 'fallback',
  };
}

async function runAIAnalysis(text, language) {
  const provider = CONFIG.provider;
  if (provider === 'none') return runLocalFallback(text, language);

  const keyMissing = (provider === 'openai' && !CONFIG.openai.apiKey) || (provider === 'claude' && !CONFIG.claude.apiKey);
  if (keyMissing) {
    console.warn(`⚠️  ${provider} key missing — using Smart Triage fallback`);
    return { ...runLocalFallback(text, language), fallbackReason: `${provider} key not configured` };
  }

  try {
    const result = provider === 'openai' ? await analyzeSymptomsWithOpenAI(text, language)
                 : provider === 'claude' ? await analyzeSymptomsWithClaude(text, language)
                 : (() => { throw new Error(`Unknown provider: ${provider}`); })();
    return result;
  } catch (err) {
    console.error(`❌ AI failed: ${err.message}`);
    if (CONFIG.fallbackOnError) return { ...runLocalFallback(text, language), fallbackReason: err.message };
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /api/health ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const aiKeyReady = CONFIG.provider === 'none' || (CONFIG.provider === 'openai' ? !!CONFIG.openai.apiKey : !!CONFIG.claude.apiKey);
  res.json({
    status: 'ok',
    version: '4.1',
    provider: CONFIG.provider,
    model: CONFIG.openai.model,
    aiReady: aiKeyReady,
    fallbackEnabled: CONFIG.fallbackOnError,
    uptime: process.uptime(),
    historyCount: predictionHistory.length,
    message: aiKeyReady ? `HealthGuard AI v4.2 — ${CONFIG.provider} (${CONFIG.openai.model})` : `HealthGuard AI v4.2 — Smart Triage fallback active`,
  });
});

// ── POST /api/analyze ─────────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { text, language = 'en', patientAge, patientGender, severity, questionnaire } = req.body;

  if (!text?.trim()) {
    return res.status(400).json({ success: false, error: 'Missing or empty "text" field.' });
  }

  const trimmed = text.trim().slice(0, 2000);
  const start   = Date.now();
  const hasQuestionnaire = questionnaire && Object.keys(questionnaire).length > 1;
  console.log(`\n📥 [analyze] lang:${language} | interview:${hasQuestionnaire ? 'YES' : 'NO'} | "${trimmed.slice(0, 80)}..."`);

  try {
    const result = await runAIAnalysis(trimmed, language);
    const response = {
      success: true,
      source: result.source,
      provider: result.source === 'ai' ? CONFIG.provider : 'smart-triage',
      model: result.source === 'ai' ? CONFIG.openai.model : 'smart-triage-engine',
      processingMs: Date.now() - start,
      input: trimmed,
      language,
      patientAge, patientGender, severity,
      questionnaire: questionnaire || null,
      symptoms:           result.symptoms,
      condition:          result.condition,
      conditions:         result.conditions,
      possibleConditions: result.possibleConditions || [],
      risk:               result.risk,
      riskLevel:          result.riskLevel || result.risk,
      advice:             result.advice,
      medicalAdvice:      result.medicalAdvice || result.advice,
      emergencyWarning:   result.emergencyWarning || '',
      isEmergency:        result.isEmergency,
      confidence:         result.confidence,
      debug: { fallbackReason: result.fallbackReason || null },
    };

    // Store in server-side history
    predictionHistory.unshift({ ...response, timestamp: Date.now() });
    if (predictionHistory.length > MAX_HISTORY) predictionHistory.pop();

    console.log(`📤 [analyze] → ${response.riskLevel} | ${response.condition} | ${response.processingMs}ms`);
    res.json(response);

  } catch (err) {
    console.error(`❌ [analyze] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/interview ──────────────────────────────────────────────────────
// Dedicated endpoint for questionnaire-enriched analysis
app.post('/api/interview', async (req, res) => {
  const { symptoms, questionnaire = {}, language = 'en' } = req.body;
  if (!symptoms && !Object.keys(questionnaire).length) {
    return res.status(400).json({ success: false, error: 'Missing symptoms or questionnaire.' });
  }
  const q = questionnaire;
  const combined = [
    symptoms || '',
    q.duration    ? `Duration: ${q.duration}` : '',
    q.age         ? `Age: ${q.age}` : '',
    q.gender      ? `Gender: ${q.gender}` : '',
    q.medication  ? `Medication: ${q.medication}` : '',
    q.remedies    ? `Remedies tried: ${q.remedies}` : '',
    q.fever_level ? `Fever: ${q.fever_level}` : '',
    q.fatigue     ? `Fatigue: ${q.fatigue}` : '',
    q.onset       ? `Onset: ${q.onset}` : '',
    q.existing    ? `Existing conditions: ${q.existing}` : '',
    q.allergies   ? `Allergies: ${q.allergies}` : '',
    q.history     ? `History: ${q.history}` : '',
    q.trend       ? `Trend: ${q.trend}` : '',
  ].filter(Boolean).join('. ');
  const start = Date.now();
  console.log(`\n📋 [interview] lang:${language} | "${combined.slice(0,80)}..."`);
  try {
    const result = await runAIAnalysis(combined, language);
    res.json({
      success: true,
      source: result.source,
      processingMs: Date.now() - start,
      symptoms: result.symptoms,
      condition: result.condition,
      possibleConditions: result.possibleConditions || [],
      risk: result.risk,
      riskLevel: result.riskLevel || result.risk,
      medicalAdvice: result.medicalAdvice,
      emergencyWarning: result.emergencyWarning || '',
      isEmergency: result.isEmergency,
      confidence: result.confidence,
      questionnaire: q,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /measure-heart-rate ──────────────────────────────────────────────────
// Calls the Python rPPG heart rate detector script
app.post('/measure-heart-rate', (req, res) => {
  const { demo = false, duration = 15, camera = 0 } = req.body || {};
  const scriptPath = path.join(__dirname, '../heart_rate_detector.py');

  if (!fs.existsSync(scriptPath)) {
    return res.status(500).json({ success: false, error: 'heart_rate_detector.py not found.' });
  }

  const args = [
    scriptPath,
    '--duration', String(Math.min(Math.max(parseInt(duration) || 15, 5), 30)),
    '--camera',   String(parseInt(camera) || 0),
  ];
  if (demo) args.push('--demo');

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const timeoutMs = (parseInt(duration) || 15) * 1000 + 10000; // duration + 10s buffer

  console.log(`\n💓 [heart-rate] Starting rPPG scan (${demo ? 'DEMO' : 'LIVE'}, ${duration}s)...`);
  const start = Date.now();

  execFile(pythonCmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
    const elapsed = Date.now() - start;
    if (err) {
      console.error(`❌ [heart-rate] Script error: ${err.message}`);
      // If Python not found, return friendly error
      if (err.code === 'ENOENT') {
        return res.status(500).json({
          success: false,
          error: 'Python 3 is required but not found. Please install Python 3.',
          error_type: 'python_missing'
        });
      }
      // Try to parse stdout anyway (script may have printed JSON before erroring)
      try {
        const result = JSON.parse(stdout.trim());
        return res.json(result);
      } catch {}
      return res.status(500).json({ success: false, error: err.message, error_type: 'exec' });
    }

    try {
      const result = JSON.parse(stdout.trim());
      console.log(`💓 [heart-rate] BPM=${result.bpm} quality=${result.signal_quality} (${elapsed}ms)`);
      res.json(result);
    } catch (parseErr) {
      console.error(`❌ [heart-rate] JSON parse failed: ${stdout}`);
      res.status(500).json({ success: false, error: 'Failed to parse heart rate result.', raw: stdout });
    }
  });
});


app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║         🏥  HealthGuard AI  v4.1  RUNNING               ║
╠══════════════════════════════════════════════════════════╣
║  URL      : http://localhost:${PORT}                       ║
║  Provider : ${CONFIG.provider.toUpperCase().padEnd(8)} ${CONFIG.openai.model.padEnd(28)} ║
║  AI Key   : ${CONFIG.openai.apiKey ? '✅ Loaded                                  ' : '❌ Missing — Smart Triage fallback active  '} ║
╠══════════════════════════════════════════════════════════╣
║  POST /api/analyze     ← symptom analysis               ║
║  POST /api/explain     ← AI clinical explanation        ║
║  GET  /api/history     ← prediction history             ║
║  GET  /api/health      ← server status                  ║
║  GET  /api/symptoms    ← symptom database               ║
║  GET  /api/stats       ← analytics                      ║
╚══════════════════════════════════════════════════════════╝
`);
});

module.exports = app;
