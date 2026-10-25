const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// Simple cookie parser utility
const parseCookies = (cookieHeader) => {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (name) acc[name.trim()] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
};

// Safe string comparison to prevent timing attacks
const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a); const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA); // Dummy check
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

module.exports = (app, models, config) => {
  const adminRouter = express.Router();
  const { Appointment, ContactMessage } = models;

  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_insecure_secret_do_not_use';
  const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin';

  if (!process.env.JWT_SECRET || !process.env.ADMIN_USERNAME) {
    console.warn("WARNING: Missing Admin Env Variables. Using unsafe defaults for development.");
  }

  // Auth Middleware
  const requireAdmin = (req, res, next) => {
    const token = parseCookies(req.headers.cookie).admin_token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      jwt.verify(token, JWT_SECRET);
      next();
    } catch (err) {
      res.status(401).json({ error: "Invalid session" });
    }
  };

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: "Too many login attempts" } });

  // Admin API Routes
  adminRouter.post('/api/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    if (safeCompare(username, ADMIN_USER) && safeCompare(password, ADMIN_PASS)) {
      const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
      res.cookie('admin_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 8*60*60*1000 });
      return res.json({ success: true, token });
    }
    res.status(401).json({ error: "Invalid credentials" });
  });

  adminRouter.post('/api/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.json({ success: true });
  });

  adminRouter.get('/api/stats', requireAdmin, async (req, res) => {
    try {
      const total = await Appointment.countDocuments();
      const pending = await Appointment.countDocuments({ status: 'pending' });
      const completed = await Appointment.countDocuments({ status: 'completed' });
      const unread = await ContactMessage.countDocuments({ isRead: false });
      
      const todayStr = new Date().toISOString().split('T')[0];
      const todayAppts = await Appointment.find({ date: todayStr }).sort('timeSlot').limit(10);
      
      // 7-day chart data
      const chartData = [];
      for(let i=6; i>=0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().split('T')[0];
        const count = await Appointment.countDocuments({ date: ds });
        chartData.push({ date: ds.slice(5), count });
      }

      res.json({ total, pending, completed, unread, todayAppts, chartData });
    } catch (err) { res.status(500).json({ error: "Error fetching stats" }); }
  });

  adminRouter.get('/api/appointments', requireAdmin, async (req, res) => {
    try {
      const { status, search } = req.query;
      const query = {};
      if (status) query.status = status;
      if (search) query.$or = [{ patientName: new RegExp(search, 'i') }, { phone: new RegExp(search, 'i') }, { reference: new RegExp(search, 'i') }];
      
      const appts = await Appointment.find(query).sort({ date: -1, timeSlot: 1 }).limit(50);
      res.json(appts);
    } catch (err) { res.status(500).json({ error: "Fetch error" }); }
  });

  adminRouter.patch('/api/appointments/:id', requireAdmin, async (req, res) => {
    try {
      const { status } = req.body;
      const appt = await Appointment.findByIdAndUpdate(req.params.id, { status }, { new: true });
      res.json(appt);
    } catch (err) { res.status(500).json({ error: "Update failed" }); }
  });

  adminRouter.delete('/api/appointments/:id', requireAdmin, async (req, res) => {
    try {
      await Appointment.findByIdAndDelete(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
  });

  adminRouter.get('/api/messages', requireAdmin, async (req, res) => {
    const msgs = await ContactMessage.find().sort({ createdAt: -1 }).limit(30);
    res.json(msgs);
  });

  adminRouter.patch('/api/messages/:id/read', requireAdmin, async (req, res) => {
    await ContactMessage.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  });

  adminRouter.get('/api/export', requireAdmin, async (req, res) => {
    const appts = await Appointment.find().lean();
    if(!appts.length) return res.send("No data");
    const header = Object.keys(appts[0]).filter(k => k !== '__v').join(',');
    const rows = appts.map(a => Object.keys(appts[0]).filter(k => k !== '__v').map(k => `"${String(a[k]).replace(/"/g, '""')}"`).join(','));
    res.header('Content-Type', 'text/csv');
    res.attachment('appointments.csv');
    res.send([header, ...rows].join('\\n'));
  });

  // Admin UI HTML
  const renderAdminHTML = () => `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin | ${config.clinicName}</title>
    <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      :root {
        --bg: #f0f4f8; --primary: #6cc6ff; --success: #7ee8c7; --danger: #ff9ec7; --warning: #ffe27a;
        --text: #2b2d52; --white: #ffffff;
        --clay: 12px 12px 24px rgba(0,0,0,0.05), -8px -8px 20px rgba(255,255,255,0.8), inset -2px -2px 6px rgba(0,0,0,0.02), inset 2px 2px 6px rgba(255,255,255,0.5);
      }
      * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Nunito', sans-serif; }
      body { background: var(--bg); color: var(--text); }
      .clay-card { background: var(--white); border-radius: 24px; box-shadow: var(--clay); padding: 24px; }
      .btn { padding: 8px 16px; border-radius: 12px; border: none; cursor: pointer; font-weight: bold; transition: 0.2s; box-shadow: var(--clay); background: var(--white); }
      .btn:active { transform: scale(0.95); }
      .btn-primary { background: var(--primary); color: white; }
      .input { width: 100%; padding: 12px; border-radius: 12px; border: none; background: #f4f9ff; margin-bottom: 16px; box-shadow: inset 4px 4px 8px rgba(0,0,0,0.05); }
      
      /* Login Screen */
      #login-screen { height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--bg), #e2e8f0); }
      .login-box { width: 100%; max-width: 400px; text-align: center; }
      
      /* Dashboard Layout */
      #dashboard { display: none; min-height: 100vh; }
      .sidebar { width: 250px; background: white; padding: 24px; position: fixed; height: 100vh; box-shadow: 4px 0 24px rgba(0,0,0,0.05); }
      .nav-item { padding: 12px; margin-bottom: 8px; border-radius: 12px; cursor: pointer; font-weight: 600; color: #666; transition: 0.2s; }
      .nav-item:hover, .nav-item.active { background: #f4f9ff; color: var(--primary); }
      .main-content { margin-left: 250px; padding: 32px; width: calc(100% - 250px); }
      
      /* Stats & Charts */
      .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 24px; margin-bottom: 32px; }
      .stat-val { font-size: 2rem; font-weight: bold; color: var(--primary); }
      .chart-container { display: flex; align-items: flex-end; gap: 16px; height: 200px; padding: 24px 0 0; border-bottom: 2px solid #eee; }
      .bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
      .bar { width: 100%; max-width: 40px; background: var(--primary); border-radius: 8px 8px 0 0; transition: height 1s; min-height: 5px; }
      .bar-label { font-size: 0.8rem; margin-top: 8px; color: #888; }
      
      /* Tables */
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
      .badge { padding: 4px 8px; border-radius: 8px; font-size: 0.8rem; font-weight: bold; }
      .badge.pending { background: #fff3cd; color: #856404; }
      .badge.confirmed { background: #cce5ff; color: #004085; }
      .badge.completed { background: #d4edda; color: #155724; }
      .badge.cancelled { background: #f8d7da; color: #721c24; }

      /* Toast */
      #toast { position: fixed; bottom: 24px; right: 24px; background: var(--text); color: white; padding: 12px 24px; border-radius: 12px; transform: translateY(100px); opacity: 0; transition: 0.3s; z-index: 1000; }
      #toast.show { transform: translateY(0); opacity: 1; }

      @media(max-width: 768px) {
        .sidebar { transform: translateX(-100%); transition: 0.3s; z-index: 100; }
        .sidebar.open { transform: translateX(0); }
        .main-content { margin-left: 0; width: 100%; padding: 16px; }
        .mobile-header { display: flex !important; justify-content: space-between; align-items: center; margin-bottom: 24px; }
      }
    </style>
  </head>
  <body>
    
    <!-- Login -->
    <div id="login-screen">
      <div class="clay-card login-box">
        <h2 style="margin-bottom:24px; color:var(--primary);">Admin Login</h2>
        <form onsubmit="handleLogin(event)">
          <input type="text" id="username" class="input" placeholder="Username" required>
          <input type="password" id="password" class="input" placeholder="Password" required>
          <button type="submit" class="btn btn-primary" style="width:100%;">Login</button>
        </form>
        <p id="login-error" style="color:red; margin-top:16px; display:none;"></p>
      </div>
    </div>

    <!-- Dashboard -->
    <div id="dashboard">
      <div class="sidebar" id="sidebar">
        <h2 style="color:var(--primary); margin-bottom:32px;">SmileCare</h2>
        <div class="nav-item active" onclick="switchTab('home')">🏠 Dashboard</div>
        <div class="nav-item" onclick="switchTab('appts')">📅 Appointments</div>
        <div class="nav-item" onclick="switchTab('msgs')">✉️ Messages</div>
        <div class="nav-item" onclick="logout()" style="margin-top:auto; color:var(--danger);">🚪 Logout</div>
      </div>
      
      <div class="main-content">
        <div class="mobile-header" style="display:none;">
          <button class="btn" onclick="document.getElementById('sidebar').classList.toggle('open')">☰ Menu</button>
          <h2>Admin</h2>
        </div>

        <!-- Home Tab -->
        <div id="tab-home" class="tab-content">
          <h2 style="margin-bottom:24px;">Overview</h2>
          <div class="stats-grid">
            <div class="clay-card"><div style="color:#888;">Total</div><div class="stat-val" id="st-tot">0</div></div>
            <div class="clay-card"><div style="color:#888;">Pending</div><div class="stat-val" id="st-pen">0</div></div>
            <div class="clay-card"><div style="color:#888;">Completed</div><div class="stat-val" id="st-com">0</div></div>
            <div class="clay-card"><div style="color:#888;">Unread Msgs</div><div class="stat-val" id="st-msg">0</div></div>
          </div>
          <div class="clay-card">
            <h3>7-Day Bookings</h3>
            <div class="chart-container" id="chart"></div>
          </div>
        </div>

        <!-- Appointments Tab -->
        <div id="tab-appts" class="tab-content" style="display:none;">
          <div style="display:flex; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
            <h2>Appointments</h2>
            <div>
              <input type="text" id="search-appt" class="input" style="width:auto; margin:0;" placeholder="Search..." onkeyup="loadAppts()">
              <button class="btn btn-primary" onclick="window.open('/admin/api/export')">Export CSV</button>
            </div>
          </div>
          <div class="clay-card" style="overflow-x:auto;">
            <table>
              <thead><tr><th>Ref</th><th>Patient</th><th>Service</th><th>Date/Time</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody id="appts-tbody"></tbody>
            </table>
          </div>
        </div>

        <!-- Messages Tab -->
        <div id="tab-msgs" class="tab-content" style="display:none;">
          <h2 style="margin-bottom:24px;">Messages</h2>
          <div class="clay-card" id="msgs-container"></div>
        </div>

      </div>
    </div>

    <div id="toast">Message</div>

    <script>
      const showToast = (msg) => { const t = document.getElementById('toast'); t.innerText = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); };
      
      const api = async (url, options={}) => {
        const res = await fetch(url, options);
        if(res.status === 401) { document.getElementById('login-screen').style.display = 'flex'; document.getElementById('dashboard').style.display = 'none'; throw new Error("Unauthorized"); }
        return res.json();
      };

      const handleLogin = async (e) => {
        e.preventDefault();
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        try {
          const res = await fetch('/admin/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u, password:p}) });
          if(res.ok) { initDash(); }
          else document.getElementById('login-error').style.display = 'block', document.getElementById('login-error').innerText = "Invalid credentials";
        } catch(err) { console.error(err); }
      };

      const logout = async () => { await fetch('/admin/api/logout', {method:'POST'}); window.location.reload(); };

      const switchTab = (tab) => {
        document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById('tab-'+tab).style.display = 'block';
        event.target.classList.add('active');
        if(window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
        if(tab === 'appts') loadAppts();
        if(tab === 'msgs') loadMsgs();
      };

      const initDash = async () => {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        const stats = await api('/admin/api/stats');
        document.getElementById('st-tot').innerText = stats.total;
        document.getElementById('st-pen').innerText = stats.pending;
        document.getElementById('st-com').innerText = stats.completed;
        document.getElementById('st-msg').innerText = stats.unread;
        
        // Render Chart
        const max = Math.max(...stats.chartData.map(d => d.count), 1);
        document.getElementById('chart').innerHTML = stats.chartData.map(d => \`
          <div class="bar-wrap">
            <div style="font-size:0.8rem; margin-bottom:4px;">\${d.count}</div>
            <div class="bar" style="height: \${(d.count/max)*100}%"></div>
            <div class="bar-label">\${d.date}</div>
          </div>
        \`).join('');
      };

      const loadAppts = async () => {
        const q = document.getElementById('search-appt').value;
        const appts = await api('/admin/api/appointments?search='+q);
        document.getElementById('appts-tbody').innerHTML = appts.map(a => \`
          <tr>
            <td>\${a.reference}</td>
            <td><strong>\${a.patientName}</strong><br><small>\${a.phone}</small></td>
            <td>\${a.service} <br><small>\${a.doctor}</small></td>
            <td>\${a.date} <br>\${a.timeSlot}</td>
            <td><span class="badge \${a.status}">\${a.status.toUpperCase()}</span></td>
            <td>
              <select onchange="updateStatus('\${a._id}', this.value)" style="padding:4px; border-radius:4px;">
                <option value="">Set Status...</option>
                <option value="confirmed">Confirm</option>
                <option value="completed">Complete</option>
                <option value="cancelled">Cancel</option>
              </select>
              <button onclick="delAppt('\${a._id}')" class="btn" style="padding:4px 8px; color:red; margin-left:4px;">X</button>
            </td>
          </tr>
        \`).join('');
      };

      const updateStatus = async (id, status) => {
        if(!status) return;
        await api('/admin/api/appointments/'+id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status}) });
        showToast('Status updated');
        loadAppts(); initDash();
      };

      const delAppt = async (id) => {
        if(!confirm("Delete this appointment?")) return;
        await api('/admin/api/appointments/'+id, { method:'DELETE' });
        showToast('Deleted');
        loadAppts(); initDash();
      };

      const loadMsgs = async () => {
        const msgs = await api('/admin/api/messages');
        document.getElementById('msgs-container').innerHTML = msgs.length ? msgs.map(m => \`
          <div style="padding:16px; border-bottom:1px solid #eee; background:\${m.isRead?'transparent':'#f4f9ff'};">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
              <strong>\${m.name} (\${m.email})</strong>
              \${!m.isRead ? \`<button class="btn" style="padding:4px 8px; font-size:0.8rem;" onclick="markRead('\${m._id}')">Mark Read</button>\` : ''}
            </div>
            <p>\${m.message}</p>
          </div>
        \`).join('') : '<p>No messages.</p>';
      };

      const markRead = async (id) => {
        await api('/admin/api/messages/'+id+'/read', {method:'PATCH'});
        showToast('Marked as read');
        loadMsgs(); initDash();
      };

      // Check login on load
      initDash().catch(() => {});
    </script>
  </body>
  </html>
  `;

  adminRouter.get('/', (req, res) => {
    res.send(renderAdminHTML());
  });

  app.use('/admin', adminRouter);
};
