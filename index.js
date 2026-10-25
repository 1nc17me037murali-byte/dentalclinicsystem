/**
 * ENVIRONMENT VARIABLES REQUIRED IN VERCEL:
 * 1. MONGODB_URI (MongoDB Atlas Connection String - Ensure 0.0.0.0/0 is allowed in Network Access)
 * 2. ADMIN_USERNAME (e.g., admin)
 * 3. ADMIN_PASSWORD (e.g., your_secure_password)
 * 4. JWT_SECRET (e.g., long_random_secret_string)
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// ==========================================
// 1. CONFIGURATION (DUMMY CLIENT DATA)
// ==========================================
const CONFIG = {
  clinicName: "SmileCare Dental Studio",
  tagline: "Healthy Teeth. Happy Smiles.",
  phone: "+91 98765 43210",
  email: "hello@smilecaredental.example",
  address: "24, Garden Street, Indiranagar, Bengaluru, Karnataka 560038",
  hours: "Mon-Sat 9:00 AM - 7:00 PM, Sunday Closed (Emergency 24/7)",
  socials: { facebook: "#", instagram: "#", twitter: "#" },
  doctors: [
    { id: "dr-ananya", name: "Dr. Ananya Rao", specialty: "Cosmetic Dentist", experience: "12 yrs", img: "https://i.pravatar.cc/300?img=47" },
    { id: "dr-rohan", name: "Dr. Rohan Mehta", specialty: "Orthodontist", experience: "10 yrs", img: "https://i.pravatar.cc/300?img=11" },
    { id: "dr-priya", name: "Dr. Priya Nair", specialty: "Pediatric Dentist", experience: "8 yrs", img: "https://i.pravatar.cc/300?img=5" },
    { id: "dr-karan", name: "Dr. Karan Shah", specialty: "Implant Surgeon", experience: "15 yrs", img: "https://i.pravatar.cc/300?img=13" }
  ],
  services: [
    { id: "s1", name: "General Checkup", icon: "🦷", desc: "Comprehensive dental examination.", price: "₹500", color: "#6cc6ff" },
    { id: "s2", name: "Teeth Whitening", icon: "✨", desc: "Brighten your smile in one visit.", price: "₹3000", color: "#ffb88c" },
    { id: "s3", name: "Braces & Aligners", icon: "😬", desc: "Straighten teeth invisibly.", price: "₹40000", color: "#b9a3ff" },
    { id: "s4", name: "Dental Implants", icon: "🔩", desc: "Permanent tooth replacement.", price: "₹35000", color: "#ff9ec7" },
    { id: "s5", name: "Root Canal", icon: "⚕️", desc: "Painless decay treatment.", price: "₹4500", color: "#7ee8c7" },
    { id: "s6", name: "Kids Dentistry", icon: "🧸", desc: "Gentle care for little smiles.", price: "₹800", color: "#ffe27a" },
    { id: "s7", name: "Cosmetic Design", icon: "💎", desc: "Veneers and smile makeovers.", price: "₹15000", color: "#6cc6ff" },
    { id: "s8", name: "Emergency Care", icon: "🚨", desc: "Immediate pain relief 24/7.", price: "₹1000", color: "#ff9ec7" }
  ],
  testimonials: [
    { name: "Rahul S.", text: "Best dental experience ever! Painless and professional.", rating: 5 },
    { name: "Anita K.", text: "Dr. Ananya transformed my smile. Highly recommend!", rating: 5 },
    { name: "Vikram M.", text: "Very friendly staff and modern clinic setup.", rating: 4 },
    { name: "Sneha P.", text: "My kids actually love visiting the dentist now.", rating: 5 },
    { name: "John D.", text: "Fast emergency service. Saved my weekend.", rating: 5 },
    { name: "Pooja R.", text: "Clear aligners process was smooth and affordable.", rating: 5 }
  ],
  faqs: [
    { q: "Do you accept dental insurance?", a: "Yes, we accept most major health insurance plans. Please contact us for details." },
    { q: "Is teeth whitening safe?", a: "Absolutely. We use FDA-approved materials that protect your enamel." },
    { q: "How often should I get a checkup?", a: "We recommend a routine checkup and cleaning every 6 months." },
    { q: "Do root canals hurt?", a: "With modern anesthesia, a root canal is virtually painless, similar to a regular filling." },
    { q: "What are your payment options?", a: "We accept Cash, UPI, Credit/Debit cards, and offer EMI options." },
    { q: "Can I book a same-day appointment?", a: "Yes, we keep emergency slots open daily. Call us directly for urgent needs." }
  ],
  timeSlots: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"]
};

// ==========================================
// 2. SERVERLESS-SAFE MONGODB & MODELS
// ==========================================
let cachedDb = null;
const connectDB = async () => {
  if (cachedDb) return cachedDb;
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing");
  const conn = await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  cachedDb = conn;
  return conn;
};

const AppointmentSchema = new mongoose.Schema({
  patientName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true },
  service: { type: String, required: true },
  doctor: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  timeSlot: { type: String, required: true },
  message: { type: String, trim: true },
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled'], default: 'pending' },
  reference: { type: String, unique: true }
}, { timestamps: true });

// Prevent double booking
AppointmentSchema.index({ doctor: 1, date: 1, timeSlot: 1 }, { unique: true, partialFilterExpression: { status: { $ne: 'cancelled' } } });

const ContactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  message: { type: String, required: true },
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

const Appointment = mongoose.models.Appointment || mongoose.model('Appointment', AppointmentSchema);
const ContactMessage = mongoose.models.ContactMessage || mongoose.model('ContactMessage', ContactSchema);
const models = { Appointment, ContactMessage };

// ==========================================
// 3. EXPRESS SETUP & MIDDLEWARE
// ==========================================
const app = express();
app.set('trust proxy', 1); // For Vercel rate limiting

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:", "https://i.pravatar.cc", "https://images.unsplash.com"],
      connectSrc: ["'self'"]
    },
  }
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const dbMiddleware = async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: "Database connection failed. Check MONGODB_URI." });
  }
};

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, message: { error: "Too many requests" } });

// ==========================================
// 4. PUBLIC API ROUTES
// ==========================================
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));
app.get('/api/config', (req, res) => res.json(CONFIG));

app.get('/api/slots', dbMiddleware, async (req, res) => {
  const { date, doctor } = req.query;
  if (!date || !doctor) return res.status(400).json({ error: "Date and doctor required" });
  try {
    const booked = await Appointment.find({ date, doctor, status: { $ne: 'cancelled' } }).select('timeSlot -_id');
    const bookedSlots = booked.map(b => b.timeSlot);
    res.json({ allSlots: CONFIG.timeSlots, bookedSlots, availableSlots: CONFIG.timeSlots.filter(s => !bookedSlots.includes(s)) });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/api/appointments', apiLimiter, dbMiddleware, async (req, res) => {
  try {
    const { patientName, phone, email, service, doctor, date, timeSlot, message } = req.body;
    if (!patientName || !phone || !service || !doctor || !date || !timeSlot) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const d = new Date(date);
    if (d.getDay() === 0) return res.status(400).json({ error: "Sundays are closed" });
    if (d < new Date(new Date().setHours(0,0,0,0))) return res.status(400).json({ error: "Cannot book in the past" });
    
    const reference = `SC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const appt = new Appointment({ patientName: String(patientName), phone: String(phone), email: String(email||''), service: String(service), doctor: String(doctor), date: String(date), timeSlot: String(timeSlot), message: String(message||''), reference });
    await appt.save();
    res.status(201).json({ success: true, reference, message: "Booking confirmed!" });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "This slot was just taken. Please choose another." });
    res.status(500).json({ error: "Booking failed. Try again." });
  }
});

app.post('/api/contact', apiLimiter, dbMiddleware, async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: "Missing required fields" });
    await ContactMessage.create({ name: String(name), email: String(email), phone: String(phone||''), message: String(message) });
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ==========================================
// 5. PUBLIC WEBSITE (FRONTEND HTML/CSS/JS)
// ==========================================
const renderPublicHTML = () => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${CONFIG.clinicName} | ${CONFIG.tagline}</title>
  <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --mint: #7ee8c7; --sky: #6cc6ff; --lavender: #b9a3ff; --peach: #ffb88c; --pink: #ff9ec7; --yellow: #ffe27a;
      --bg: linear-gradient(135deg, #eaf6ff 0%, #fdf0ff 100%);
      --text: #2b2d52; --text-light: #5a5c82; --white: #ffffff;
      --clay-bg: rgba(255, 255, 255, 0.7);
      --clay-shadow: 12px 12px 24px rgba(108,198,255,0.15), -8px -8px 20px rgba(255,255,255,0.8);
      --clay-shadow-hover: 16px 16px 30px rgba(108,198,255,0.2), -10px -10px 24px rgba(255,255,255,0.9);
      --clay-inset: inset -6px -6px 12px rgba(0,0,0,0.03), inset 6px 6px 12px rgba(255,255,255,0.9);
      --radius-sm: 16px; --radius-md: 24px; --radius-lg: 32px; --radius-xl: 48px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Nunito', sans-serif; }
    body { background: var(--bg); color: var(--text); overflow-x: hidden; scroll-behavior: smooth; }
    h1, h2, h3, h4 { font-family: 'Baloo 2', cursive; line-height: 1.2; }
    a { text-decoration: none; color: inherit; }
    .clay { background: var(--clay-bg); backdrop-filter: blur(10px); border-radius: var(--radius-lg); box-shadow: var(--clay-shadow), var(--clay-inset); border: 1px solid rgba(255,255,255,0.5); transition: all 0.3s ease; }
    .clay:hover { box-shadow: var(--clay-shadow-hover), var(--clay-inset); transform: translateY(-4px); }
    .clay-btn { background: var(--mint); color: var(--text); padding: 12px 24px; border-radius: var(--radius-xl); font-weight: bold; border: none; cursor: pointer; box-shadow: 6px 6px 12px rgba(126,232,199,0.4), -4px -4px 10px rgba(255,255,255,0.8), inset -3px -3px 6px rgba(0,0,0,0.1), inset 3px 3px 6px rgba(255,255,255,0.6); transition: all 0.2s; display: inline-flex; align-items: center; gap: 8px; }
    .clay-btn:hover { transform: translateY(-2px); filter: brightness(1.05); }
    .clay-btn:active { transform: scale(0.96); box-shadow: 2px 2px 4px rgba(126,232,199,0.4), -2px -2px 4px rgba(255,255,255,0.8), inset -2px -2px 4px rgba(0,0,0,0.1); }
    .clay-input { width: 100%; padding: 14px 20px; border-radius: var(--radius-sm); border: none; background: #f4f9ff; box-shadow: inset 4px 4px 8px rgba(0,0,0,0.05), inset -4px -4px 8px rgba(255,255,255,0.8); margin-bottom: 16px; font-family: 'Nunito'; font-size: 16px; outline: none; }
    .clay-input:focus { box-shadow: inset 6px 6px 12px rgba(108,198,255,0.1), inset -6px -6px 12px rgba(255,255,255,0.9); }
    
    /* Layout */
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    section { padding: 80px 0; position: relative; }
    .text-center { text-align: center; }
    .section-title { font-size: 2.5rem; margin-bottom: 16px; }
    .section-sub { font-size: 1.1rem; color: var(--text-light); margin-bottom: 48px; max-width: 600px; margin-inline: auto; }
    .grid { display: grid; gap: 24px; }
    .grid-2 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
    .grid-3 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .grid-4 { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }

    /* Navbar */
    header { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); width: calc(100% - 32px); max-width: 1200px; z-index: 100; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; }
    .logo { font-family: 'Baloo 2'; font-size: 1.5rem; font-weight: 800; display: flex; align-items: center; gap: 8px; }
    .nav-links { display: flex; gap: 24px; align-items: center; }
    .nav-links a { font-weight: 600; color: var(--text-light); transition: color 0.3s; }
    .nav-links a:hover { color: var(--sky); }
    .hamburger { display: none; background: none; border: none; font-size: 24px; cursor: pointer; }

    /* Hero */
    .hero { min-height: 100vh; display: flex; align-items: center; padding-top: 120px; }
    .hero-content { flex: 1; }
    .hero h1 { font-size: 4rem; margin-bottom: 16px; background: linear-gradient(45deg, var(--sky), var(--lavender)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero p { font-size: 1.2rem; color: var(--text-light); margin-bottom: 32px; max-width: 500px; }
    .hero-img { flex: 1; text-align: center; position: relative; }
    .mascot { width: 100%; max-width: 400px; animation: float 4s ease-in-out infinite; filter: drop-shadow(10px 10px 20px rgba(0,0,0,0.1)); }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }
    .blobs { position: absolute; width: 100%; height: 100%; top: 0; left: 0; z-index: -1; opacity: 0.5; }
    .blob { position: absolute; border-radius: 50%; filter: blur(40px); animation: morph 8s infinite alternate; }
    @keyframes morph { 0% { border-radius: 40% 60% 70% 30% / 40% 40% 60% 50%; transform: scale(1); } 100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: scale(1.1); } }

    /* Stats */
    .stats-wrap { display: flex; justify-content: space-around; flex-wrap: wrap; gap: 24px; padding: 40px; background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--clay-shadow); margin-top: -40px; position: relative; z-index: 10; }
    .stat-item h3 { font-size: 2.5rem; color: var(--sky); margin-bottom: 4px; }
    .stat-item p { font-weight: 600; color: var(--text-light); }

    /* Services */
    .service-card { padding: 32px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; }
    .service-icon { font-size: 3rem; margin-bottom: 16px; width: 80px; height: 80px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #fff; box-shadow: var(--clay-shadow); }
    .service-price { margin-top: 16px; font-weight: 700; color: var(--lavender); background: #fff; padding: 4px 12px; border-radius: 20px; font-size: 0.9rem; }

    /* Doctors */
    .doctor-card { padding: 24px; text-align: center; }
    .doc-img { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; margin: 0 auto 16px; border: 4px solid #fff; box-shadow: var(--clay-shadow); }
    .doc-spec { color: var(--sky); font-weight: 600; font-size: 0.9rem; margin-bottom: 16px; }

    /* Booking */
    .booking-section { background: linear-gradient(135deg, var(--lavender) 0%, var(--sky) 100%); border-radius: var(--radius-xl); padding: 40px; box-shadow: var(--clay-shadow); color: white; position: relative; overflow: hidden; }
    .booking-card { background: var(--white); color: var(--text); padding: 40px; width: 100%; max-width: 600px; margin: 0 auto; z-index: 2; position: relative; }
    .step { display: none; animation: fadeIn 0.4s; }
    .step.active { display: block; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .slot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .slot-chip { padding: 8px; text-align: center; background: #f4f9ff; border-radius: var(--radius-sm); font-size: 0.9rem; cursor: pointer; box-shadow: inset 2px 2px 5px rgba(0,0,0,0.05); transition: 0.2s; border: 2px solid transparent; }
    .slot-chip:hover:not(.disabled) { background: var(--sky); color: white; }
    .slot-chip.selected { background: var(--sky); color: white; border-color: var(--mint); box-shadow: 0 4px 10px rgba(108,198,255,0.4); }
    .slot-chip.disabled { opacity: 0.4; cursor: not-allowed; text-decoration: line-through; }
    .progress { height: 8px; background: #eee; border-radius: 4px; margin-bottom: 24px; overflow: hidden; }
    .progress-bar { height: 100%; background: var(--mint); width: 33%; transition: 0.3s; }
    #confetti { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 100; }

    /* Reviews, Gallery, Pricing, FAQ */
    .review-card { padding: 24px; }
    .stars { color: var(--yellow); margin-bottom: 8px; }
    .gallery-img { width: 100%; height: 250px; object-fit: cover; border-radius: var(--radius-md); }
    .price-card { padding: 40px 24px; text-align: center; }
    .price-card.featured { transform: scale(1.05); border: 2px solid var(--sky); }
    .faq-item { margin-bottom: 16px; cursor: pointer; }
    .faq-q { padding: 16px; font-weight: bold; display: flex; justify-content: space-between; }
    .faq-a { padding: 0 16px; max-height: 0; overflow: hidden; transition: 0.3s; color: var(--text-light); }
    .faq-item.active .faq-a { padding: 0 16px 16px; max-height: 200px; }
    
    /* Footer & Utils */
    footer { padding: 60px 24px 24px; background: white; text-align: center; margin-top: 80px; border-radius: var(--radius-xl) var(--radius-xl) 0 0; }
    .float-btn { position: fixed; bottom: 24px; right: 24px; width: 60px; height: 60px; background: #25D366; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 30px; box-shadow: 0 10px 20px rgba(37,211,102,0.4); z-index: 99; animation: pulse 2s infinite; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(37,211,102,0.4); } 70% { box-shadow: 0 0 0 15px rgba(37,211,102,0); } 100% { box-shadow: 0 0 0 0 rgba(37,211,102,0); } }
    .reveal { opacity: 0; transform: translateY(40px); transition: all 0.8s ease-out; }
    .reveal.visible { opacity: 1; transform: translateY(0); }
    
    @media(max-width: 768px) {
      .nav-links { display: none; position: absolute; top: 70px; left: 0; width: 100%; background: var(--clay-bg); flex-direction: column; padding: 24px; border-radius: var(--radius-lg); backdrop-filter: blur(10px); box-shadow: var(--clay-shadow); }
      .nav-links.show { display: flex; }
      .hamburger { display: block; }
      .hero { flex-direction: column; text-align: center; padding-top: 100px; }
      .hero h1 { font-size: 2.5rem; }
      .stats-wrap { flex-direction: column; }
    }
  </style>
</head>
<body>
  <!-- Config Injection -->
  <script>window.CONFIG = ${JSON.stringify(CONFIG)};</script>

  <!-- Navbar -->
  <header class="clay">
    <div class="logo">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="var(--sky)"><path d="M12 2C8 2 4 4 4 9c0 2 1 4 2 6l2 5c.5 1 2 1 2.5 0l1.5-4 1.5 4c.5 1 2 1 2.5 0l2-5c1-2 2-4 2-6 0-5-4-7-8-7z"/></svg>
      ${CONFIG.clinicName}
    </div>
    <div class="nav-links">
      <a href="#services">Services</a>
      <a href="#doctors">Doctors</a>
      <a href="#gallery">Gallery</a>
      <a href="#contact">Contact</a>
      <a href="#booking" class="clay-btn" style="background: var(--sky); color: white;">Book Now</a>
    </div>
    <button class="hamburger">☰</button>
  </header>

  <!-- Hero -->
  <section class="container hero reveal">
    <div class="hero-content">
      <div class="blobs"><div class="blob" style="background:var(--pink);width:300px;height:300px;top:-50px;left:-50px;"></div></div>
      <h1>${CONFIG.tagline}</h1>
      <p>Experience pain-free, modern dentistry in a relaxing environment. Join 15,000+ happy patients.</p>
      <div style="display:flex; gap:16px; flex-wrap:wrap; justify-content:center;">
        <a href="#booking" class="clay-btn">Book Appointment ✨</a>
        <a href="#services" class="clay-btn" style="background:white;">Our Services</a>
      </div>
    </div>
    <div class="hero-img">
      <svg class="mascot" viewBox="0 0 200 200" fill="none">
        <path d="M100 20 C60 20 30 40 30 90 C30 110 40 130 50 150 L65 185 C70 195 85 195 90 185 L100 150 L110 185 C115 195 130 195 135 185 L150 150 C160 130 170 110 170 90 C170 40 140 20 100 20 Z" fill="white" stroke="var(--sky)" stroke-width="4"/>
        <circle cx="75" cy="85" r="8" fill="var(--text)"/>
        <circle cx="125" cy="85" r="8" fill="var(--text)"/>
        <path d="M80 110 Q100 130 120 110" stroke="var(--pink)" stroke-width="6" stroke-linecap="round" fill="none"/>
        <path d="M135 70 Q145 60 155 70" stroke="var(--text)" stroke-width="3" stroke-linecap="round" fill="none"/>
        <path d="M65 70 Q55 60 45 70" stroke="var(--text)" stroke-width="3" stroke-linecap="round" fill="none"/>
      </svg>
      <div class="blobs"><div class="blob" style="background:var(--mint);width:200px;height:200px;bottom:0;right:0;"></div></div>
    </div>
  </section>

  <!-- Stats -->
  <div class="container reveal">
    <div class="stats-wrap">
      <div class="stat-item text-center"><h3 class="count" data-target="15">0</h3><p>Years Experience</p></div>
      <div class="stat-item text-center"><h3 class="count" data-target="15000">0</h3><p>Happy Patients</p></div>
      <div class="stat-item text-center"><h3 class="count" data-target="4">0</h3><p>Expert Doctors</p></div>
      <div class="stat-item text-center"><h3 class="count" data-target="20">0</h3><p>Awards Won</p></div>
    </div>
  </div>

  <!-- Services -->
  <section id="services" class="container reveal">
    <h2 class="section-title text-center">Our Treatments</h2>
    <p class="section-sub text-center">Comprehensive dental care for the whole family.</p>
    <div class="grid grid-4" id="services-container">
      ${CONFIG.services.map(s => `
        <div class="clay service-card">
          <div class="service-icon" style="color:${s.color}">${s.icon}</div>
          <h3>${s.name}</h3>
          <p style="font-size:0.9rem; color:var(--text-light); margin-top:8px;">${s.desc}</p>
          <div class="service-price">From ${s.price}</div>
        </div>
      `).join('')}
    </div>
  </section>

  <!-- Doctors -->
  <section id="doctors" class="container reveal">
    <h2 class="section-title text-center">Meet Our Experts</h2>
    <p class="section-sub text-center">Highly qualified professionals dedicated to your smile.</p>
    <div class="grid grid-4">
      ${CONFIG.doctors.map(d => `
        <div class="clay doctor-card">
          <img src="${d.img}" alt="${d.name}" class="doc-img" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'120\\' height=\\'120\\'><rect width=\\'120\\' height=\\'120\\' fill=\\'%23eee\\'/></svg>'">
          <h3>${d.name}</h3>
          <p class="doc-spec">${d.specialty}</p>
          <p style="font-size:0.85rem; margin-bottom:16px;">${d.experience} Experience</p>
          <button class="clay-btn btn-book-doc" data-doc="${d.id}" style="width:100%; justify-content:center;">Book ${d.name.split(' ')[1]}</button>
        </div>
      `).join('')}
    </div>
  </section>

  <!-- Booking Section -->
  <section id="booking" class="container reveal">
    <div class="booking-section">
      <div class="blobs"><div class="blob" style="background:rgba(255,255,255,0.2);width:400px;height:400px;top:-100px;left:-100px;"></div></div>
      <h2 class="section-title text-center">Book an Appointment</h2>
      <p class="section-sub text-center" style="color:#fff;">Three simple steps to your best smile.</p>
      
      <div class="clay booking-card">
        <canvas id="confetti"></canvas>
        <div class="progress"><div class="progress-bar" id="pbar"></div></div>
        
        <form id="bookingForm" onsubmit="event.preventDefault();">
          <!-- Step 1 -->
          <div class="step active" id="step1">
            <h3>1. What do you need help with?</h3>
            <select id="b_service" class="clay-input" required>
              <option value="">Select Service...</option>
              ${CONFIG.services.map(s => `<option value="${s.name}">${s.name}</option>`).join('')}
            </select>
            <h3 style="margin-top:16px;">Choose a Doctor</h3>
            <select id="b_doctor" class="clay-input" required>
              <option value="">Any Available Doctor...</option>
              ${CONFIG.doctors.map(d => `<option value="${d.name}">${d.name} - ${d.specialty}</option>`).join('')}
            </select>
            <button type="button" class="clay-btn next-btn" style="width:100%; justify-content:center; margin-top:16px;">Next: Choose Time ➔</button>
          </div>

          <!-- Step 2 -->
          <div class="step" id="step2">
            <h3>2. When should we expect you?</h3>
            <input type="date" id="b_date" class="clay-input" required>
            <p id="date-error" style="color:red; font-size:0.85rem; display:none;">Sundays are closed. Please select another day.</p>
            <div id="slots-loader" style="display:none; text-align:center; padding:16px;">Loading slots...</div>
            <div class="slot-grid" id="slots-container"></div>
            <input type="hidden" id="b_time" required>
            <div style="display:flex; gap:16px; margin-top:16px;">
              <button type="button" class="clay-btn prev-btn" style="background:#eee; flex:1; justify-content:center;">Back</button>
              <button type="button" class="clay-btn next-btn" style="flex:2; justify-content:center;" id="step2-next">Next: Your Details ➔</button>
            </div>
          </div>

          <!-- Step 3 -->
          <div class="step" id="step3">
            <h3>3. Patient Details</h3>
            <input type="text" id="b_name" class="clay-input" placeholder="Full Name" required>
            <input type="tel" id="b_phone" class="clay-input" placeholder="Phone Number" required pattern="[0-9]{10}">
            <input type="email" id="b_email" class="clay-input" placeholder="Email (Optional)">
            <textarea id="b_msg" class="clay-input" placeholder="Any specific notes?" rows="2"></textarea>
            <div id="form-error" style="color:red; margin-bottom:16px; font-size:0.9rem;"></div>
            <div style="display:flex; gap:16px;">
              <button type="button" class="clay-btn prev-btn" style="background:#eee; flex:1; justify-content:center;">Back</button>
              <button type="submit" class="clay-btn" style="flex:2; justify-content:center; background:var(--sky); color:white;" id="submit-btn">Confirm Booking ✔</button>
            </div>
          </div>

          <!-- Success -->
          <div class="step text-center" id="step-success">
            <div class="service-icon" style="color:var(--mint); margin: 0 auto;">🎉</div>
            <h3 style="margin:16px 0;">Booking Confirmed!</h3>
            <p>Your reference is: <strong id="b_ref"></strong></p>
            <p style="color:var(--text-light); margin-top:8px;">We'll contact you shortly to remind you.</p>
            <button type="button" class="clay-btn" onclick="location.reload()" style="margin-top:24px;">Done</button>
          </div>
        </form>
      </div>
    </div>
  </section>

  <!-- Gallery & Reviews (Combined Grid for brevity) -->
  <section id="gallery" class="container reveal">
    <div class="grid grid-2">
      <div>
        <h2 class="section-title">Smile Gallery</h2>
        <div class="grid grid-2" style="gap:12px;">
          <img src="https://images.unsplash.com/photo-1606811841689-23dfddce3e95?w=400&q=80" class="clay gallery-img" alt="Clinic">
          <img src="https://images.unsplash.com/photo-1598256989800-fea5ce514220?w=400&q=80" class="clay gallery-img" alt="Smile">
        </div>
      </div>
      <div>
        <h2 class="section-title">Patient Stories</h2>
        <div class="grid" style="gap:16px;">
          ${CONFIG.testimonials.slice(0,3).map(t => `
            <div class="clay review-card">
              <div class="stars">★★★★★</div>
              <p>"${t.text}"</p>
              <h4 style="margin-top:8px;">- ${t.name}</h4>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="container reveal" style="max-width:800px;">
    <h2 class="section-title text-center">Got Questions?</h2>
    <div class="clay" style="padding:16px;">
      ${CONFIG.faqs.map((f, i) => `
        <div class="clay faq-item" onclick="this.classList.toggle('active')">
          <div class="faq-q">${f.q} <span>+</span></div>
          <div class="faq-a">${f.a}</div>
        </div>
      `).join('')}
    </div>
  </section>

  <!-- Contact & Footer -->
  <section id="contact" class="container reveal">
    <div class="clay" style="padding:40px; display:flex; flex-wrap:wrap; gap:40px;">
      <div style="flex:1; min-width:300px;">
        <h2 class="section-title">Contact Us</h2>
        <p><strong>📍 Address:</strong> ${CONFIG.address}</p>
        <p style="margin:16px 0;"><strong>📞 Phone:</strong> ${CONFIG.phone}</p>
        <p><strong>⏰ Hours:</strong> ${CONFIG.hours}</p>
        <form id="contactForm" style="margin-top:24px;">
          <input type="text" id="c_name" class="clay-input" placeholder="Name" required>
          <input type="email" id="c_email" class="clay-input" placeholder="Email" required>
          <textarea id="c_msg" class="clay-input" placeholder="Message" required rows="3"></textarea>
          <button type="submit" class="clay-btn" id="c_btn">Send Message</button>
          <div id="c_res" style="margin-top:8px;"></div>
        </form>
      </div>
      <div style="flex:1; min-width:300px;">
        <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3887.973167198759!2d77.6409!3d12.9716!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMTLCsDU4JzE3LjgiTiA3N8KwMzgnMjcuMiJF!5e0!3m2!1sen!2sin!4v1620000000000!5m2!1sen!2sin" width="100%" height="100%" style="border:0; border-radius:24px; min-height:300px;" allowfullscreen="" loading="lazy"></iframe>
      </div>
    </div>
  </section>

  <footer>
    <h3>${CONFIG.clinicName}</h3>
    <p>${CONFIG.tagline}</p>
    <div style="margin: 16px 0;">
      <a href="/admin" style="color:var(--text-light); text-decoration:underline;">Admin Panel</a>
    </div>
    <p style="color:var(--text-light); font-size:0.9rem;">&copy; 2026 ${CONFIG.clinicName}. All rights reserved.</p>
  </footer>

  <a href="https://wa.me/${CONFIG.phone.replace(/[^0-9]/g, '')}" class="float-btn" target="_blank">💬</a>

  <script>
    // Utils
    const $ = id => document.getElementById(id);
    
    // UI Interactions
    document.querySelector('.hamburger').onclick = () => document.querySelector('.nav-links').classList.toggle('show');
    
    // Scroll Reveal
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => { if(e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    // Animated Counters
    const runCounters = () => {
      document.querySelectorAll('.count').forEach(counter => {
        const update = () => {
          const target = +counter.getAttribute('data-target');
          const c = +counter.innerText;
          const inc = target / 50;
          if(c < target) { counter.innerText = Math.ceil(c + inc); setTimeout(update, 30); }
          else counter.innerText = target + (target > 100 ? '+' : '');
        };
        update();
      });
    };
    new IntersectionObserver((e) => { if(e[0].isIntersecting) runCounters(); }).observe(document.querySelector('.stats-wrap'));

    // Date Picker Logic
    const dateInput = $('b_date');
    const today = new Date();
    dateInput.min = today.toISOString().split('T')[0];
    dateInput.addEventListener('change', async (e) => {
      const d = new Date(e.target.value);
      if(d.getDay() === 0) {
        $('date-error').style.display = 'block';
        e.target.value = '';
        $('slots-container').innerHTML = '';
        return;
      }
      $('date-error').style.display = 'none';
      await loadSlots();
    });
    $('b_doctor').addEventListener('change', () => { if(dateInput.value) loadSlots(); });

    async function loadSlots() {
      const date = dateInput.value;
      const doc = $('b_doctor').value;
      if(!date || !doc) return;
      $('slots-loader').style.display = 'block';
      $('slots-container').innerHTML = '';
      try {
        const res = await fetch(\`/api/slots?date=\${date}&doctor=\${doc}\`);
        const data = await res.json();
        $('slots-loader').style.display = 'none';
        
        if(!data.allSlots) return;
        $('slots-container').innerHTML = data.allSlots.map(time => {
          const isBooked = data.bookedSlots.includes(time);
          return \`<div class="slot-chip \${isBooked ? 'disabled' : ''}" onclick="\${!isBooked ? \`selectSlot(this, '\${time}')\` : ''}">\${time}</div>\`;
        }).join('');
      } catch(err) {
        $('slots-loader').innerText = "Failed to load slots.";
      }
    }

    function selectSlot(el, time) {
      document.querySelectorAll('.slot-chip').forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');
      $('b_time').value = time;
    }

    // Booking Multi-step Logic
    let currentStep = 1;
    const steps = [$('step1'), $('step2'), $('step3'), $('step-success')];
    const updateSteps = () => {
      steps.forEach((s, i) => { if(s) s.classList.toggle('active', i+1 === currentStep); });
      $('pbar').style.width = currentStep === 1 ? '33%' : currentStep === 2 ? '66%' : '100%';
    };
    
    document.querySelectorAll('.next-btn').forEach((btn, idx) => {
      btn.onclick = () => {
        if(currentStep === 1 && (!$('b_service').value || !$('b_doctor').value)) return alert("Select service & doctor");
        if(currentStep === 2 && (!$('b_date').value || !$('b_time').value)) return alert("Select date & time");
        currentStep++; updateSteps();
      };
    });
    document.querySelectorAll('.prev-btn').forEach(btn => { btn.onclick = () => { currentStep--; updateSteps(); }; });
    
    // Quick book buttons
    document.querySelectorAll('.btn-book-doc').forEach(btn => {
      btn.onclick = (e) => {
        const docId = e.target.getAttribute('data-doc');
        const docName = window.CONFIG.doctors.find(d => d.id === docId).name;
        $('b_doctor').value = docName;
        document.querySelector('#booking').scrollIntoView();
      };
    });

    // Submit Booking
    $('bookingForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('submit-btn');
      btn.innerText = "Booking..."; btn.disabled = true;
      const payload = {
        patientName: $('b_name').value, phone: $('b_phone').value, email: $('b_email').value,
        service: $('b_service').value, doctor: $('b_doctor').value, date: $('b_date').value,
        timeSlot: $('b_time').value, message: $('b_msg').value
      };
      try {
        const res = await fetch('/api/appointments', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
        const data = await res.json();
        if(res.ok) {
          $('b_ref').innerText = data.reference;
          currentStep = 4; updateSteps(); fireConfetti();
        } else {
          $('form-error').innerText = data.error || "Booking failed.";
        }
      } catch(err) {
        $('form-error').innerText = "Network error. Try again.";
      }
      btn.innerText = "Confirm Booking ✔"; btn.disabled = false;
    };

    // Contact Form
    $('contactForm').onsubmit = async (e) => {
      e.preventDefault();
      $('c_btn').innerText = "Sending...";
      const res = await fetch('/api/contact', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:$('c_name').value, email:$('c_email').value, message:$('c_msg').value})});
      if(res.ok) { $('c_res').innerText = "Message sent!"; $('contactForm').reset(); }
      else $('c_res').innerText = "Failed to send.";
      $('c_btn').innerText = "Send Message";
    };

    // Confetti (Lightweight pure JS)
    function fireConfetti() {
      const canvas = $('confetti');
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
      const pieces = Array.from({length:100}).map(() => ({
        x: canvas.width/2, y: canvas.height/2, vx: (Math.random()-0.5)*20, vy: (Math.random()-1)*20,
        size: Math.random()*8+4, color: ['#7ee8c7','#6cc6ff','#b9a3ff','#ffb88c','#ff9ec7'][Math.floor(Math.random()*5)]
      }));
      const anim = () => {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        let active = false;
        pieces.forEach(p => {
          p.x += p.vx; p.y += p.vy; p.vy += 0.5; // gravity
          if(p.y < canvas.height) {
            ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
            active = true;
          }
        });
        if(active) requestAnimationFrame(anim);
      };
      anim();
    }
  </script>
</body>
</html>
`;

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.send(renderPublicHTML());
});

// ==========================================
// 6. MOUNT ADMIN MODULE
// ==========================================
require('./admin')(app, models, CONFIG);

// 404 & Global Error Handlers
app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

// Vercel Export / Local Listen
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;
