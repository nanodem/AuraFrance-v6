# 🇫🇷 AuraFrance Systems — v6.0 (Production Ready)

منصة الاستثمار والتعدين السحابي — نسخة متكاملة ومحدّثة بالكامل.

---

## 🚀 تشغيل المشروع

```bash
# 1. تثبيت الحزم
npm install

# 2. تشغيل الخادم (الإنتاج)
npm start

# 3. للتطوير مع إعادة تشغيل تلقائي
npm run dev
```

المنصة تعمل على: `http://localhost:3000`

---

## 🔐 بيانات الدخول (الإدمن)

| الحقل | القيمة |
|-------|--------|
| معرف الإدمن | `AURA_FR_ADMIN` |
| كلمة المرور | `Aura@France_2026!$` |
| رقم الهاتف | `Admin_France` |

---

## 📁 هيكل المشروع

```
AuraFrance/
├── server.js           ← الخادم الكامل (Express + WebSocket + Cron)
├── package.json        ← التبعيات
├── .env                ← المتغيرات البيئية (يجب تعديلها)
├── README.md           ← هذا الملف
├── data/
│   └── db.json        ← قاعدة البيانات (JSON)
├── uploads/           ← ملفات المرفوعة (صور الإيصالات والأفاتار)
└── public/
    ├── index.html     ← تطبيق React الكامل (SPA)
    ├── manifest.json  ← PWA manifest
    └── sw.js          ← Service Worker
```

---

## ✅ المميزات المُطبَّقة (v6.0)

### 🔐 نظام المصادقة
- ✅ JWT Access Token + Refresh Token (آمن تماماً)
- ✅ 3 أنواع مستخدمين: إدمن، مشرف، موظف
- ✅ تسجيل دخول مستقل لكل دور
- ✅ إجبار المشرف على تغيير كلمة المرور عند أول دخول
- ✅ نظام OTP للعمليات الكبيرة (≥500 USDT)
- ✅ Rate Limiting للحماية من Brute Force

### 💰 نظام الإيداع الحقيقي
- ✅ دعم TRC20 / BEP20 / ERC20
- ✅ توليد QR Code تلقائي
- ✅ جدول deposits كامل (مع TXID، الشبكة، الحالة...)
- ✅ تدفق مراحل: شبكة → مبلغ → عنوان → تأكيد → نجاح
- ✅ WebSocket لتحديثات فورية
- ✅ أزرار اختيار سريع (500، 1500، 2600، 5000، 10000 USDT)
- ✅ تكامل TRON API للتحقق التلقائي
- ✅ التحقق الآلي عبر Cron كل 2 دقيقة

### ⬆️ نظام السحب
- ✅ مدة تأخير برمجية (24-72 ساعة)
- ✅ رسوم متغيرة (18% تنخفض مع كل موظف جديد)
- ✅ OTP إلزامي للمبالغ ≥ 500 USDT
- ✅ موافقة الإدمن/المشرف على السحوبات

### 🏛️ الصلاحيات (RBAC)
- ✅ إدمن: لوحة تحكم كاملة، إدارة المشرفين والموظفين
- ✅ إدمن: عرض بيانات الموظفين الكاملة + أكثرهم سحباً
- ✅ مشرف: محفظة خاصة، إدارة فريقه، خصم النقاط يدوياً
- ✅ موظف: الإيداع، السحب، الباقات، عجلة الحظ

### 💹 التدفق المالي الحقيقي
- ✅ 15% من كل إيداع موظف → محفظة مشرفه مباشرة
- ✅ قيمة الباقات → محفظة الإدمن
- ✅ المشرف وحده يسحب من محفظته

### ⭐ نظام النقاط
- ✅ 100 نقطة عند التسجيل
- ✅ +2 نقطة عند شراء باقة
- ✅ Cron Job: -5 نقاط بعد 18 يوم بدون نشاط
- ✅ كل 5 نقاط منقوصة = -10% من العائد اليومي

### 🎡 عجلة الحظ
- ✅ نسبة فوز 0.5% دقيقة (خوارزمية صارمة)
- ✅ مرة واحدة يومياً
- ✅ جوائز: 5، 10، 50، 100، 500 USDT

### 📦 الباقات الاستثمارية
- ✅ 6 باقات: Starter، Silver، Gold، Platinum، Diamond، VIP
- ✅ عوائد يومية من 0.5% إلى 4%

### 🛡️ الأمان
- ✅ Helmet.js لحماية HTTP Headers
- ✅ CORS مُضبَط
- ✅ Rate Limiting
- ✅ bcryptjs لتشفير كلمات المرور (12 rounds)
- ✅ منع DevTools وكليك يمين (عبر JS)
- ✅ PWA مع Service Worker

---

## ⚙️ إعداد الإنتاج

### 1. تعديل ملف .env
```env
# مهم جداً: غيّر هذه القيم!
JWT_SECRET=سر-قوي-ومعقد-هنا
JWT_REFRESH_SECRET=سر-آخر-قوي-هنا

# عناوين محافظك الحقيقية
DEPOSIT_WALLET_TRC20=عنوان-trc20-الحقيقي
DEPOSIT_WALLET_BEP20=عنوان-bep20-الحقيقي

# مفتاح TRON API
TRONGRID_API_KEY=مفتاح-trongrid-الخاص-بك
```

### 2. الحصول على TRON API Key
- سجّل في https://www.trongrid.io
- أنشئ مفتاح API
- ضعه في TRONGRID_API_KEY

### 3. تغيير عناوين المحافظ
- اذهب إلى إعدادات المنصة (لوحة الإدمن → ⚙️)
- أدخل عناوين محافظك الحقيقية

---

## 🔧 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | تسجيل الدخول |
| POST | /api/auth/register | تسجيل جديد |
| POST | /api/auth/refresh | تجديد التوكن |
| POST | /api/auth/logout | تسجيل الخروج |
| POST | /api/deposit/create | إنشاء إيداع |
| POST | /api/deposit/submit | إرسال TXID |
| GET | /api/deposit/status/:id | حالة الإيداع |
| WS | /ws/deposit/:id | WebSocket للتحديث الفوري |
| POST | /api/withdraw/request | طلب سحب |
| GET | /api/packages | قائمة الباقات |
| POST | /api/packages/buy | شراء باقة |
| POST | /api/lucky-wheel/spin | دوران عجلة الحظ |
| GET | /api/admin/stats | إحصائيات الإدمن |
| GET | /api/admin/users | قائمة الموظفين |
| POST | /api/admin/supervisors | إنشاء مشرف |

---

## ✈️ تيليجرام

https://t.me/+C0Z9ls7s3DRjOWVi

---

## 💻 المتطلبات

- Node.js 18+
- npm 8+
- اتصال إنترنت (لـ Google Fonts و React CDN)

---

*AuraFrance Systems © 2024-2026 | Paris, France*
