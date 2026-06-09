require('dotenv').config();
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const cron = require('node-cron');
const multer = require('multer');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// ─── DB helpers ────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data', 'db.json');

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: [], supervisors: [], deposits: [], withdrawals: [], transactions: [], tickets: [], otp_codes: [], refresh_tokens: [], lucky_wheel_history: [], system: {} }; }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── File upload ────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  }
});

// ─── Middleware ──────────────────────────────────────────────────
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/', apiLimiter);

// ─── JWT helpers ─────────────────────────────────────────────────
function signAccess(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
}
function signRefresh(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });
}
function verifyAccess(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}
function verifyRefresh(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = verifyAccess(auth.split(' ')[1]);
    next();
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}
function supervisorOrAdmin(req, res, next) {
  if (!['admin', 'supervisor'].includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ─── OTP ─────────────────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
function storeOTP(userId, code, purpose = 'login') {
  const db = readDB();
  db.otp_codes = db.otp_codes.filter(o => o.userId !== userId || o.purpose !== purpose);
  db.otp_codes.push({ userId, code, purpose, expiresAt: Date.now() + 5 * 60 * 1000, createdAt: Date.now() });
  writeDB(db);
  return code;
}
function verifyOTP(userId, code, purpose = 'login') {
  const db = readDB();
  const otp = db.otp_codes.find(o => o.userId === userId && o.purpose === purpose && o.code === code);
  if (!otp) return false;
  if (Date.now() > otp.expiresAt) return false;
  db.otp_codes = db.otp_codes.filter(o => !(o.userId === userId && o.purpose === purpose));
  writeDB(db);
  return true;
}

// ─── Wallet address per network ──────────────────────────────────
function getWalletAddress(network) {
  const db = readDB();
  switch (network) {
    case 'TRC20': return db.system.usdtAddressTRC20 || process.env.DEPOSIT_WALLET_TRC20;
    case 'BEP20': return db.system.usdtAddressBEP20 || process.env.DEPOSIT_WALLET_BEP20;
    case 'ERC20': return db.system.usdtAddressERC20 || process.env.DEPOSIT_WALLET_ERC20;
    default: return db.system.usdtAddressTRC20;
  }
}

// ─── Points helpers ──────────────────────────────────────────────
function calcSalaryMultiplier(points) {
  const base = 100;
  if (points >= base) return 1.0;
  const lost = base - points;
  const brackets = Math.floor(lost / 5);
  const deduction = brackets * 0.10;
  return Math.max(0, 1.0 - deduction);
}

// ─── Financial flow helpers ───────────────────────────────────────
function addTransaction(db, userId, type, amount, description, meta = {}) {
  db.transactions.push({
    id: uuidv4(),
    userId,
    type,
    amount,
    description,
    meta,
    createdAt: new Date().toISOString()
  });
}

// ─────────────────────────────────────────────────────────────────
//  AUTH ROUTES
// ─────────────────────────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { identifier, password, role = 'user', otp } = req.body;
  const db = readDB();

  // ADMIN
  if (role === 'admin') {
    if (identifier !== process.env.ADMIN_ID || password !== process.env.ADMIN_PASSWORD)
      return res.status(401).json({ error: 'بيانات خاطئة' });
    const tokens = issueTokens({ id: 'admin', role: 'admin', name: process.env.ADMIN_NAME });
    return res.json({ ...tokens, user: { id: 'admin', role: 'admin', name: process.env.ADMIN_NAME } });
  }

  // SUPERVISOR
  if (role === 'supervisor') {
    const sup = db.supervisors.find(s => s.supervisorId === identifier);
    if (!sup) return res.status(401).json({ error: 'المشرف غير موجود' });
    const valid = await bcrypt.compare(password, sup.passwordHash);
    if (!valid) return res.status(401).json({ error: 'كلمة مرور خاطئة' });
    const tokens = issueTokens({ id: sup.id, role: 'supervisor', name: sup.name, supervisorId: sup.supervisorId });
    return res.json({ ...tokens, user: { id: sup.id, role: 'supervisor', name: sup.name, supervisorId: sup.supervisorId, mustChangePassword: sup.mustChangePassword } });
  }

  // EMPLOYEE
  const user = db.users.find(u => u.phone === identifier || u.id === identifier);
  if (!user) return res.status(401).json({ error: 'المستخدم غير موجود' });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'كلمة مرور خاطئة' });

  const tokens = issueTokens({ id: user.id, role: 'employee', name: user.name });
  return res.json({ ...tokens, user: { id: user.id, role: 'employee', name: user.name, balance: user.balance, points: user.points } });
});

function issueTokens(payload) {
  const accessToken = signAccess(payload);
  const refreshToken = signRefresh(payload);
  const db = readDB();
  db.refresh_tokens.push({ token: refreshToken, userId: payload.id, createdAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 3600 * 1000 });
  writeDB(db);
  return { accessToken, refreshToken };
}

// POST /api/auth/refresh
app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'No token' });
  try {
    const payload = verifyRefresh(refreshToken);
    const db = readDB();
    const stored = db.refresh_tokens.find(t => t.token === refreshToken);
    if (!stored || Date.now() > stored.expiresAt) return res.status(401).json({ error: 'Token expired' });
    const newAccess = signAccess({ id: payload.id, role: payload.role, name: payload.name, supervisorId: payload.supervisorId });
    return res.json({ accessToken: newAccess });
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const { refreshToken } = req.body;
  const db = readDB();
  db.refresh_tokens = db.refresh_tokens.filter(t => t.token !== refreshToken);
  writeDB(db);
  return res.json({ ok: true });
});

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { name, phone, password, referralCode } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  const db = readDB();
  if (db.users.find(u => u.phone === phone)) return res.status(400).json({ error: 'الهاتف مسجل مسبقاً' });

  const passwordHash = await bcrypt.hash(password, 12);
  const id = uuidv4();
  const now = new Date().toISOString();

  // Find supervisor via referral
  let supervisorId = null;
  if (referralCode) {
    const ref = db.users.find(u => u.referralCode === referralCode);
    if (ref) supervisorId = ref.supervisorId || ref.id;
    const sup = db.supervisors.find(s => s.referralCode === referralCode);
    if (sup) supervisorId = sup.id;
  }

  const user = {
    id, name, phone, passwordHash, role: 'employee',
    balance: 0, supervisorBalance: 0, points: 100,
    referralCode: uuidv4().slice(0, 8).toUpperCase(),
    supervisorId, referredBy: referralCode || null,
    createdAt: now, lastActivity: now,
    avatar: null, package: null,
    withdrawalCount: 0, totalWithdrawn: 0,
    isActive: true, banned: false
  };

  db.users.push(user);
  addTransaction(db, id, 'bonus', 0, 'تسجيل جديد — 100 نقطة مجد', {});
  writeDB(db);

  const tokens = issueTokens({ id, role: 'employee', name });
  return res.json({ ...tokens, user: { id, name, phone, role: 'employee', balance: 0, points: 100 } });
});

// POST /api/auth/otp/send
app.post('/api/auth/otp/send', (req, res) => {
  const { userId, purpose } = req.body;
  const code = generateOTP();
  storeOTP(userId, code, purpose);
  // In production: send via SMS/email
  console.log(`OTP for ${userId} [${purpose}]: ${code}`);
  return res.json({ ok: true, message: 'تم إرسال كود التحقق' });
});

// POST /api/auth/otp/verify
app.post('/api/auth/otp/verify', (req, res) => {
  const { userId, code, purpose } = req.body;
  if (!verifyOTP(userId, code, purpose)) return res.status(400).json({ error: 'كود خاطئ أو منتهي الصلاحية' });
  return res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────
//  USER PROFILE
// ─────────────────────────────────────────────────────────────────

app.get('/api/user/me', authMiddleware, (req, res) => {
  const db = readDB();
  if (req.user.role === 'admin') {
    return res.json({ id: 'admin', role: 'admin', name: process.env.ADMIN_NAME, balance: db.system.adminBalance || 0 });
  }
  if (req.user.role === 'supervisor') {
    const sup = db.supervisors.find(s => s.id === req.user.id);
    if (!sup) return res.status(404).json({ error: 'Not found' });
    return res.json({ ...sup, passwordHash: undefined });
  }
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  return res.json({ ...user, passwordHash: undefined });
});

app.post('/api/user/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const db = readDB();
  const url = `/uploads/${req.file.filename}`;
  const user = db.users.find(u => u.id === req.user.id);
  if (user) { user.avatar = url; writeDB(db); }
  return res.json({ url });
});

app.put('/api/user/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const db = readDB();
  if (req.user.role === 'supervisor') {
    const sup = db.supervisors.find(s => s.id === req.user.id);
    if (!sup) return res.status(404).json({ error: 'Not found' });
    if (!sup.mustChangePassword) {
      const valid = await bcrypt.compare(currentPassword, sup.passwordHash);
      if (!valid) return res.status(401).json({ error: 'كلمة المرور الحالية خاطئة' });
    }
    sup.passwordHash = await bcrypt.hash(newPassword, 12);
    sup.mustChangePassword = false;
    writeDB(db);
    return res.json({ ok: true });
  }
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'كلمة المرور الحالية خاطئة' });
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  writeDB(db);
  return res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────
//  DEPOSIT ROUTES
// ─────────────────────────────────────────────────────────────────

// POST /api/deposit/create
app.post('/api/deposit/create', authMiddleware, async (req, res) => {
  const { network = 'TRC20', amount } = req.body;
  if (!amount || amount < 10 || amount > 50000) return res.status(400).json({ error: 'المبلغ يجب أن يكون بين 10 و50000 USDT' });
  if (!['TRC20', 'BEP20', 'ERC20'].includes(network)) return res.status(400).json({ error: 'شبكة غير صحيحة' });

  const wallet_address = getWalletAddress(network);
  const deposit_id = uuidv4();
  const expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  let qr_url = '';
  try { qr_url = await QRCode.toDataURL(wallet_address, { width: 200, margin: 1 }); }
  catch (e) { qr_url = ''; }

  const db = readDB();
  db.deposits.push({
    id: deposit_id,
    userId: req.user.id,
    network,
    wallet_address,
    amount: parseFloat(amount),
    txid: null,
    status: 'pending',
    confirmations: 0,
    screenshot_url: null,
    created_at: new Date().toISOString(),
    confirmed_at: null,
    expires_at
  });
  writeDB(db);

  return res.json({ wallet_address, qr_url, deposit_id, expires_at, network, amount });
});

// POST /api/deposit/submit
app.post('/api/deposit/submit', authMiddleware, upload.single('screenshot'), async (req, res) => {
  const { deposit_id, txid, amount } = req.body;
  const db = readDB();
  const deposit = db.deposits.find(d => d.id === deposit_id && d.userId === req.user.id);
  if (!deposit) return res.status(404).json({ error: 'العملية غير موجودة' });
  if (deposit.status !== 'pending') return res.status(400).json({ error: 'العملية غير قابلة للتحديث' });

  // Check txid not used
  if (txid && db.deposits.find(d => d.txid === txid && d.id !== deposit_id))
    return res.status(400).json({ error: 'TXID مستخدم مسبقاً' });

  deposit.txid = txid || null;
  deposit.amount = parseFloat(amount) || deposit.amount;
  deposit.status = 'under_review';
  deposit.screenshot_url = req.file ? `/uploads/${req.file.filename}` : null;

  writeDB(db);

  // Notify via WebSocket
  broadcastDepositStatus(deposit_id, { status: 'under_review', confirmations: 0 });

  // Auto-verify after delay (simulated — in production use TRON API)
  simulateDepositVerification(deposit_id);

  return res.json({ status: 'under_review', message: 'جاري التحقق من العملية' });
});

// GET /api/deposit/status/:deposit_id
app.get('/api/deposit/status/:deposit_id', authMiddleware, (req, res) => {
  const db = readDB();
  const deposit = db.deposits.find(d => d.id === req.params.deposit_id);
  if (!deposit) return res.status(404).json({ error: 'غير موجود' });
  return res.json({ status: deposit.status, confirmations: deposit.confirmations, amount: deposit.amount, network: deposit.network, txid: deposit.txid, confirmed_at: deposit.confirmed_at });
});

// GET /api/deposit/list
app.get('/api/deposit/list', authMiddleware, (req, res) => {
  const db = readDB();
  let deposits;
  if (req.user.role === 'admin') deposits = db.deposits;
  else if (req.user.role === 'supervisor') {
    const empIds = db.users.filter(u => u.supervisorId === req.user.id).map(u => u.id);
    deposits = db.deposits.filter(d => empIds.includes(d.userId));
  } else deposits = db.deposits.filter(d => d.userId === req.user.id);
  return res.json(deposits.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

// Admin confirm deposit
app.post('/api/deposit/confirm/:deposit_id', authMiddleware, supervisorOrAdmin, async (req, res) => {
  const db = readDB();
  const deposit = db.deposits.find(d => d.id === req.params.deposit_id);
  if (!deposit) return res.status(404).json({ error: 'غير موجود' });
  confirmDeposit(db, deposit);
  writeDB(db);
  broadcastDepositStatus(deposit.id, { status: 'confirmed', confirmations: 19, amount: deposit.amount });
  return res.json({ ok: true });
});

// Admin reject deposit
app.post('/api/deposit/reject/:deposit_id', authMiddleware, supervisorOrAdmin, (req, res) => {
  const db = readDB();
  const deposit = db.deposits.find(d => d.id === req.params.deposit_id);
  if (!deposit) return res.status(404).json({ error: 'غير موجود' });
  deposit.status = 'failed';
  writeDB(db);
  broadcastDepositStatus(deposit.id, { status: 'failed' });
  return res.json({ ok: true });
});

function confirmDeposit(db, deposit) {
  deposit.status = 'confirmed';
  deposit.confirmed_at = new Date().toISOString();
  deposit.confirmations = 19;

  const user = db.users.find(u => u.id === deposit.userId);
  if (!user) return;

  const amount = deposit.amount;

  // 15% to supervisor wallet
  const supervisorCut = amount * 0.15;
  const userAmount = amount - supervisorCut;

  user.balance += userAmount;
  user.lastActivity = new Date().toISOString();

  if (user.supervisorId) {
    const sup = db.supervisors.find(s => s.id === user.supervisorId);
    if (sup) {
      sup.walletBalance = (sup.walletBalance || 0) + supervisorCut;
      addTransaction(db, sup.id, 'supervisor_cut', supervisorCut, `15% من إيداع موظف ${user.name}`, { userId: user.id });
    } else {
      // supervisor cut to admin
      db.system.adminBalance = (db.system.adminBalance || 0) + supervisorCut;
    }
  } else {
    db.system.adminBalance = (db.system.adminBalance || 0) + supervisorCut;
  }

  // Deposit amount goes to admin
  db.system.adminBalance = (db.system.adminBalance || 0) + amount;
  db.system.totalDeposits = (db.system.totalDeposits || 0) + amount;

  addTransaction(db, user.id, 'deposit', userAmount, `إيداع ${deposit.network} - ${amount} USDT`, { depositId: deposit.id, network: deposit.network });
}

function simulateDepositVerification(depositId) {
  // Simulate 3-second delay for confirmation
  setTimeout(() => {
    const db = readDB();
    const deposit = db.deposits.find(d => d.id === depositId);
    if (!deposit || deposit.status === 'confirmed' || deposit.status === 'failed') return;

    // Simulate confirmations progress
    let confirmations = 0;
    const interval = setInterval(() => {
      confirmations += Math.floor(Math.random() * 3) + 1;
      broadcastDepositStatus(depositId, { status: 'confirming', confirmations: Math.min(confirmations, 19) });
      if (confirmations >= 19) {
        clearInterval(interval);
        const db2 = readDB();
        const dep2 = db2.deposits.find(d => d.id === depositId);
        if (dep2 && dep2.status === 'under_review') {
          dep2.confirmations = 19;
          confirmDeposit(db2, dep2);
          writeDB(db2);
          broadcastDepositStatus(depositId, { status: 'confirmed', confirmations: 19, amount: dep2.amount });
        }
      } else {
        const db3 = readDB();
        const dep3 = db3.deposits.find(d => d.id === depositId);
        if (dep3) { dep3.confirmations = confirmations; writeDB(db3); }
      }
    }, 4000);
  }, 3000);
}

// ─────────────────────────────────────────────────────────────────
//  WITHDRAWAL ROUTES
// ─────────────────────────────────────────────────────────────────

// POST /api/withdraw/request
app.post('/api/withdraw/request', authMiddleware, async (req, res) => {
  const { amount, network = 'TRC20', walletAddress, otpCode } = req.body;
  const db = readDB();

  if (db.system.withdrawalsFrozen) return res.status(400).json({ error: 'السحوبات موقوفة مؤقتاً' });

  let user;
  if (req.user.role === 'supervisor') {
    user = db.supervisors.find(s => s.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if ((user.walletBalance || 0) < amount) return res.status(400).json({ error: 'رصيد غير كافٍ' });
  } else {
    user = db.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if ((user.balance || 0) < amount) return res.status(400).json({ error: 'رصيد غير كافٍ' });
  }

  if (amount < (db.system.minWithdraw || 20)) return res.status(400).json({ error: `الحد الأدنى ${db.system.minWithdraw} USDT` });

  // OTP for large withdrawals
  if (amount >= 500 && otpCode) {
    if (!verifyOTP(req.user.id, otpCode, 'withdraw')) return res.status(400).json({ error: 'كود OTP خاطئ' });
  }

  const baseFee = db.system.withdrawalFeeBase || 18;
  const employeeCount = db.users.filter(u => u.supervisorId === req.user.id || u.referredBy === req.user.id).length;
  const feeReduction = Math.min(employeeCount, baseFee);
  const fee = Math.max(0, baseFee - feeReduction);
  const netAmount = amount * (1 - fee / 100);

  const delayHours = Math.floor(Math.random() * (72 - 24 + 1)) + 24;
  const processAt = new Date(Date.now() + delayHours * 3600 * 1000).toISOString();

  const withdrawal = {
    id: uuidv4(),
    userId: req.user.id,
    role: req.user.role,
    amount: parseFloat(amount),
    netAmount,
    fee,
    network,
    walletAddress,
    status: 'pending',
    processAt,
    delayHours,
    createdAt: new Date().toISOString(),
    processedAt: null
  };

  db.withdrawals.push(withdrawal);

  if (req.user.role === 'supervisor') {
    user.walletBalance -= amount;
  } else {
    user.balance -= amount;
    user.withdrawalCount = (user.withdrawalCount || 0) + 1;
    user.totalWithdrawn = (user.totalWithdrawn || 0) + amount;
  }

  db.system.totalWithdrawals = (db.system.totalWithdrawals || 0) + amount;
  addTransaction(db, req.user.id, 'withdrawal', -amount, `طلب سحب ${amount} USDT عبر ${network}`, { withdrawalId: withdrawal.id, fee, netAmount });
  writeDB(db);

  return res.json({ ok: true, withdrawal, message: `سيتم معالجة السحب خلال ${delayHours} ساعة` });
});

// GET /api/withdraw/list
app.get('/api/withdraw/list', authMiddleware, (req, res) => {
  const db = readDB();
  let withdrawals;
  if (req.user.role === 'admin') withdrawals = db.withdrawals;
  else if (req.user.role === 'supervisor') {
    const empIds = db.users.filter(u => u.supervisorId === req.user.id).map(u => u.id);
    withdrawals = db.withdrawals.filter(w => empIds.includes(w.userId) || w.userId === req.user.id);
  } else withdrawals = db.withdrawals.filter(w => w.userId === req.user.id);
  return res.json(withdrawals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post('/api/withdraw/approve/:id', authMiddleware, supervisorOrAdmin, (req, res) => {
  const db = readDB();
  const w = db.withdrawals.find(w => w.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'غير موجود' });
  w.status = 'approved'; w.processedAt = new Date().toISOString();
  writeDB(db);
  return res.json({ ok: true });
});

app.post('/api/withdraw/reject/:id', authMiddleware, supervisorOrAdmin, (req, res) => {
  const db = readDB();
  const w = db.withdrawals.find(w => w.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'غير موجود' });
  w.status = 'rejected'; w.processedAt = new Date().toISOString();
  // Refund
  if (w.role === 'supervisor') {
    const sup = db.supervisors.find(s => s.id === w.userId);
    if (sup) sup.walletBalance = (sup.walletBalance || 0) + w.amount;
  } else {
    const user = db.users.find(u => u.id === w.userId);
    if (user) user.balance += w.amount;
  }
  writeDB(db);
  return res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────
//  PACKAGES / POSITIONS
// ─────────────────────────────────────────────────────────────────

const PACKAGES = [
  { id: 'starter', name: 'Starter', price: 500, dailyReturn: 0.5, duration: 30 },
  { id: 'silver', name: 'Silver', price: 1500, dailyReturn: 0.8, duration: 45 },
  { id: 'gold', name: 'Gold', price: 2600, dailyReturn: 1.2, duration: 60 },
  { id: 'platinum', name: 'Platinum', price: 5000, dailyReturn: 1.8, duration: 90 },
  { id: 'diamond', name: 'Diamond', price: 10000, dailyReturn: 2.5, duration: 120 },
  { id: 'vip', name: 'VIP', price: 50000, dailyReturn: 4.0, duration: 180 }
];

app.get('/api/packages', (req, res) => res.json(PACKAGES));

app.post('/api/packages/buy', authMiddleware, (req, res) => {
  const { packageId } = req.body;
  const pkg = PACKAGES.find(p => p.id === packageId);
  if (!pkg) return res.status(404).json({ error: 'الباقة غير موجودة' });

  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.balance < pkg.price) return res.status(400).json({ error: 'رصيد غير كافٍ' });

  user.balance -= pkg.price;
  user.package = { ...pkg, boughtAt: new Date().toISOString(), expiresAt: new Date(Date.now() + pkg.duration * 86400000).toISOString() };
  user.points = (user.points || 100) + 2; // +2 points on package purchase

  // Funds go to admin
  db.system.adminBalance = (db.system.adminBalance || 0) + pkg.price;

  addTransaction(db, user.id, 'package_buy', -pkg.price, `شراء باقة ${pkg.name}`, { packageId });
  writeDB(db);
  return res.json({ ok: true, user: { balance: user.balance, points: user.points, package: user.package } });
});

// ─────────────────────────────────────────────────────────────────
//  POINTS SYSTEM
// ─────────────────────────────────────────────────────────────────

app.get('/api/points/history', authMiddleware, (req, res) => {
  const db = readDB();
  const txs = db.transactions.filter(t => t.userId === req.user.id);
  return res.json(txs);
});

app.post('/api/points/deduct', authMiddleware, supervisorOrAdmin, (req, res) => {
  const { userId, points, reason } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.points = Math.max(0, (user.points || 0) - points);
  addTransaction(db, userId, 'points_deduct', -points, reason || 'خصم نقاط يدوي', { by: req.user.id });
  writeDB(db);
  return res.json({ ok: true, newPoints: user.points });
});

// ─────────────────────────────────────────────────────────────────
//  LUCKY WHEEL
// ─────────────────────────────────────────────────────────────────

const WHEEL_PRIZES = [
  { label: '5 USDT', value: 5, type: 'cash' },
  { label: '10 USDT', value: 10, type: 'cash' },
  { label: '50 USDT', value: 50, type: 'cash' },
  { label: '100 USDT', value: 100, type: 'cash' },
  { label: '500 USDT', value: 500, type: 'cash' },
  { label: '2 نقطة', value: 2, type: 'points' },
  { label: 'حظ أوفر', value: 0, type: 'none' },
  { label: 'حظ أوفر', value: 0, type: 'none' }
];

app.post('/api/lucky-wheel/spin', authMiddleware, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  // Check last spin (once per day)
  const lastSpin = db.lucky_wheel_history.filter(l => l.userId === req.user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (lastSpin) {
    const hours = (Date.now() - new Date(lastSpin.createdAt).getTime()) / 3600000;
    if (hours < 24) return res.status(400).json({ error: `يمكنك الدوران مرة واحدة يومياً. الوقت المتبقي: ${Math.ceil(24 - hours)} ساعة` });
  }

  // 0.5% win rate
  const rand = Math.random() * 100;
  const isWinner = rand < 0.5;

  let prize;
  if (isWinner) {
    const cashPrizes = WHEEL_PRIZES.filter(p => p.type !== 'none');
    prize = cashPrizes[Math.floor(Math.random() * cashPrizes.length)];
  } else {
    prize = WHEEL_PRIZES.find(p => p.type === 'none');
  }

  const spinIndex = WHEEL_PRIZES.indexOf(prize);

  if (isWinner && prize.type === 'cash') {
    user.balance = (user.balance || 0) + prize.value;
    addTransaction(db, user.id, 'lucky_wheel', prize.value, `عجلة الحظ — ${prize.label}`, {});
  } else if (isWinner && prize.type === 'points') {
    user.points = (user.points || 0) + prize.value;
    addTransaction(db, user.id, 'lucky_wheel_points', prize.value, `عجلة الحظ — ${prize.label}`, {});
  }

  db.lucky_wheel_history.push({ id: uuidv4(), userId: req.user.id, prize, isWinner, spinIndex, createdAt: new Date().toISOString() });
  writeDB(db);

  return res.json({ isWinner, prize, spinIndex, newBalance: user.balance, newPoints: user.points });
});

// ─────────────────────────────────────────────────────────────────
//  ADMIN ROUTES
// ─────────────────────────────────────────────────────────────────

app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
  const db = readDB();
  const totalUsers = db.users.length;
  const totalSupervisors = db.supervisors.length;
  const totalDeposits = db.deposits.filter(d => d.status === 'confirmed').reduce((s, d) => s + d.amount, 0);
  const totalWithdrawals = db.withdrawals.filter(w => w.status === 'approved').reduce((s, w) => s + w.amount, 0);
  const pendingDeposits = db.deposits.filter(d => d.status === 'under_review').length;
  const pendingWithdrawals = db.withdrawals.filter(w => w.status === 'pending').length;
  const topWithdrawers = db.users.sort((a, b) => (b.totalWithdrawn || 0) - (a.totalWithdrawn || 0)).slice(0, 10)
    .map(u => ({ id: u.id, name: u.name, totalWithdrawn: u.totalWithdrawn || 0 }));

  return res.json({ totalUsers, totalSupervisors, totalDeposits, totalWithdrawals, pendingDeposits, pendingWithdrawals, adminBalance: db.system.adminBalance || 0, topWithdrawers });
});

app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  const db = readDB();
  return res.json(db.users.map(u => ({ ...u, passwordHash: undefined })));
});

app.get('/api/admin/users/credentials', authMiddleware, adminOnly, (req, res) => {
  const db = readDB();
  return res.json(db.users.map(u => ({ id: u.id, name: u.name, phone: u.phone, referralCode: u.referralCode, createdAt: u.createdAt })));
});

app.post('/api/admin/users/ban/:id', authMiddleware, adminOnly, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.banned = !user.banned;
  writeDB(db);
  return res.json({ ok: true, banned: user.banned });
});

app.post('/api/admin/users/deposit/:id', authMiddleware, adminOnly, (req, res) => {
  const { amount } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.balance = (user.balance || 0) + parseFloat(amount);
  addTransaction(db, user.id, 'admin_deposit', amount, `إيداع من الإدمن`, { by: 'admin' });
  writeDB(db);
  return res.json({ ok: true, newBalance: user.balance });
});

app.get('/api/admin/supervisors', authMiddleware, adminOnly, (req, res) => {
  const db = readDB();
  return res.json(db.supervisors.map(s => ({ ...s, passwordHash: undefined })));
});

app.post('/api/admin/supervisors', authMiddleware, adminOnly, async (req, res) => {
  const { name, supervisorId, initialPassword } = req.body;
  if (!name || !supervisorId || !initialPassword) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  const db = readDB();
  if (db.supervisors.find(s => s.supervisorId === supervisorId)) return res.status(400).json({ error: 'معرف مستخدم مسبقاً' });
  const passwordHash = await bcrypt.hash(initialPassword, 12);
  const sup = {
    id: uuidv4(), name, supervisorId, passwordHash,
    walletBalance: 0, mustChangePassword: true,
    referralCode: uuidv4().slice(0, 8).toUpperCase(),
    createdAt: new Date().toISOString()
  };
  db.supervisors.push(sup);
  writeDB(db);
  return res.json({ ...sup, passwordHash: undefined });
});

app.put('/api/admin/system', authMiddleware, adminOnly, (req, res) => {
  const db = readDB();
  const { withdrawalsFrozen, maintenance, minWithdraw, usdtAddressTRC20, usdtAddressBEP20, usdtAddressERC20 } = req.body;
  if (withdrawalsFrozen !== undefined) db.system.withdrawalsFrozen = withdrawalsFrozen;
  if (maintenance !== undefined) db.system.maintenance = maintenance;
  if (minWithdraw !== undefined) db.system.minWithdraw = minWithdraw;
  if (usdtAddressTRC20) db.system.usdtAddressTRC20 = usdtAddressTRC20;
  if (usdtAddressBEP20) db.system.usdtAddressBEP20 = usdtAddressBEP20;
  if (usdtAddressERC20) db.system.usdtAddressERC20 = usdtAddressERC20;
  writeDB(db);
  return res.json({ ok: true, system: db.system });
});

app.get('/api/admin/system', authMiddleware, adminOnly, (req, res) => {
  const db = readDB();
  return res.json(db.system);
});

// ─────────────────────────────────────────────────────────────────
//  SUPERVISOR ROUTES
// ─────────────────────────────────────────────────────────────────

app.get('/api/supervisor/employees', authMiddleware, supervisorOrAdmin, (req, res) => {
  const db = readDB();
  let employees;
  if (req.user.role === 'admin') employees = db.users;
  else employees = db.users.filter(u => u.supervisorId === req.user.id);
  return res.json(employees.map(u => ({ ...u, passwordHash: undefined })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/supervisor/top-withdrawers', authMiddleware, supervisorOrAdmin, (req, res) => {
  const db = readDB();
  let employees;
  if (req.user.role === 'admin') employees = db.users;
  else employees = db.users.filter(u => u.supervisorId === req.user.id);
  return res.json(employees.sort((a, b) => (b.totalWithdrawn || 0) - (a.totalWithdrawn || 0)).slice(0, 20).map(u => ({ id: u.id, name: u.name, totalWithdrawn: u.totalWithdrawn || 0, withdrawalCount: u.withdrawalCount || 0 })));
});

app.get('/api/supervisor/stats', authMiddleware, supervisorOrAdmin, (req, res) => {
  const db = readDB();
  let employees;
  if (req.user.role === 'admin') employees = db.users;
  else employees = db.users.filter(u => u.supervisorId === req.user.id);

  const newToday = employees.filter(u => {
    const created = new Date(u.createdAt);
    const now = new Date();
    return created.toDateString() === now.toDateString();
  }).length;

  let walletBalance = 0;
  if (req.user.role === 'supervisor') {
    const sup = db.supervisors.find(s => s.id === req.user.id);
    walletBalance = sup?.walletBalance || 0;
  } else {
    walletBalance = db.system.adminBalance || 0;
  }

  return res.json({ totalEmployees: employees.length, newToday, walletBalance });
});

// ─────────────────────────────────────────────────────────────────
//  TRANSACTIONS
// ─────────────────────────────────────────────────────────────────

app.get('/api/transactions', authMiddleware, (req, res) => {
  const db = readDB();
  const txs = db.transactions.filter(t => t.userId === req.user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.json(txs);
});

// ─────────────────────────────────────────────────────────────────
//  QR CODE
// ─────────────────────────────────────────────────────────────────

app.get('/api/qr', async (req, res) => {
  const { data } = req.query;
  if (!data) return res.status(400).json({ error: 'No data' });
  try {
    const qr = await QRCode.toDataURL(data, { width: 200, margin: 1 });
    return res.json({ qr });
  } catch { return res.status(500).json({ error: 'QR generation failed' }); }
});

// ─────────────────────────────────────────────────────────────────
//  WEBSOCKET
// ─────────────────────────────────────────────────────────────────

const wsClients = new Map(); // depositId -> Set<ws>

wss.on('connection', (ws, req) => {
  const match = req.url.match(/\/ws\/deposit\/([^/?]+)/);
  if (!match) { ws.close(); return; }
  const depositId = match[1];
  if (!wsClients.has(depositId)) wsClients.set(depositId, new Set());
  wsClients.get(depositId).add(ws);

  ws.on('close', () => {
    const clients = wsClients.get(depositId);
    if (clients) { clients.delete(ws); if (clients.size === 0) wsClients.delete(depositId); }
  });

  ws.send(JSON.stringify({ type: 'connected', depositId }));
});

function broadcastDepositStatus(depositId, data) {
  const clients = wsClients.get(depositId);
  if (!clients) return;
  const msg = JSON.stringify({ type: 'deposit_update', depositId, ...data });
  clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

// ─────────────────────────────────────────────────────────────────
//  CRON JOBS
// ─────────────────────────────────────────────────────────────────

// Every day at midnight — check 18-day rule and apply point penalties
cron.schedule('0 0 * * *', () => {
  console.log('[CRON] Running 18-day penalty check...');
  const db = readDB();
  const now = Date.now();
  db.users.forEach(user => {
    const daysSinceJoining = (now - new Date(user.createdAt).getTime()) / 86400000;
    const daysSinceActivity = (now - new Date(user.lastActivity || user.createdAt).getTime()) / 86400000;
    const hasReferred = db.users.some(u => u.referredBy === user.referralCode);
    if (daysSinceJoining >= 18 && daysSinceActivity >= 18 && !hasReferred) {
      user.points = Math.max(0, (user.points || 0) - 5);
      addTransaction(db, user.id, 'points_penalty', -5, 'خصم تلقائي — 18 يوم بدون نشاط', {});
    }
  });
  writeDB(db);
});

// Every hour — process pending withdrawals past their processAt time
cron.schedule('0 * * * *', () => {
  console.log('[CRON] Processing pending withdrawals...');
  const db = readDB();
  const now = new Date();
  db.withdrawals.filter(w => w.status === 'pending').forEach(w => {
    if (new Date(w.processAt) <= now) {
      w.status = 'approved';
      w.processedAt = now.toISOString();
    }
  });
  writeDB(db);
});

// ─────────────────────────────────────────────────────────────────
//  TRON BLOCKCHAIN INTEGRATION
// ─────────────────────────────────────────────────────────────────

async function checkTronTransaction(txid, expectedAmount, expectedAddress) {
  try {
    const fetch = require('node-fetch');
    const url = `https://api.trongrid.io/v1/transactions/${txid}`;
    const res = await fetch(url, {
      headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY || '' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (e) {
    console.error('TRON check error:', e.message);
    return null;
  }
}

async function fetchTRC20Transactions(address) {
  try {
    const fetch = require('node-fetch');
    const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=20&contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;
    const res = await fetch(url, {
      headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY || '' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.error('TRC20 fetch error:', e.message);
    return [];
  }
}

// Auto-check TRON deposits every 2 minutes
cron.schedule('*/2 * * * *', async () => {
  const db = readDB();
  const pendingDeposits = db.deposits.filter(d => d.status === 'under_review' && d.txid && d.network === 'TRC20');
  if (pendingDeposits.length === 0) return;

  for (const deposit of pendingDeposits) {
    const txData = await checkTronTransaction(deposit.txid);
    if (txData && txData.ret && txData.ret[0]?.contractRet === 'SUCCESS') {
      const dbFresh = readDB();
      const dep = dbFresh.deposits.find(d => d.id === deposit.id);
      if (dep && dep.status === 'under_review') {
        dep.confirmations = 19;
        confirmDeposit(dbFresh, dep);
        writeDB(dbFresh);
        broadcastDepositStatus(dep.id, { status: 'confirmed', confirmations: 19, amount: dep.amount });
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────
//  SPA fallback
// ─────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🇫🇷 AuraFrance Systems v6.0 running on http://0.0.0.0:${PORT}`);
  console.log(`📊 WebSocket: ws://0.0.0.0:${PORT}/ws/deposit/:id`);
});

module.exports = app;
