# انشر على Render — رابط عام دائم مع HTTPS

## الخطوات البسيطة (5 دقائق فقط):

1. افتح https://render.com وسجّل دخول (استخدم حساب GitHub)

2. اضغط "+ New" في الزاوية اليسرى واختر "Web Service"

3. اربط حساب GitHub:
   - اضغط "Connect account"
   - اختر "nanodem/AuraFrance-v6"
   - اضغط "Connect"

4. ملأ الإعدادات:
   - Name: `aura-france` (أي اسم)
   - Region: `Frankfurt` أو `Singapore` (يقرب من موقعك)
   - Branch: `main`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: `Free` (كافٍ للاختبار)

5. أضف متغيرات البيئة (Environment):
   اضغط "+ Add Environment Variable" وأضف:
   - `JWT_SECRET` = (قيمة عشوائية طويلة)
   - `JWT_REFRESH_SECRET` = (قيمة عشوائية طويلة)
   - `ADMIN_ID` = `admin`
   - `ADMIN_PASSWORD` = (كلمة سر قوية)
   - `ADMIN_NAME` = `Admin`
   - `NODE_ENV` = `production`

6. اضغط "Create Web Service"

7. انتظر 3-5 دقائق لإتمام البناء والنشر

8. ستحصل على رابط عام مثل: `https://aura-france-xxxxx.onrender.com`

## بعد النشر:

- الرابط يعمل على جميع الأجهزة والدول (عام تماماً)
- HTTPS فوري (SSL مجاني من Let's Encrypt)
- تحديث تلقائي عند كل دفع إلى GitHub (اختياري — يحتاج GitHub Actions secrets)

## للتحقق من أن كل شيء يعمل:

افتح الرابط في المتصفح وتأكد أن الواجهة تظهر:
```
https://aura-france-xxxxx.onrender.com
```

أو اختبر API:
```
curl https://aura-france-xxxxx.onrender.com/api/packages
```
