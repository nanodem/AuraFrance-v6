نشر تطبيق AuraFrance على Render — خطوات سريعة للحصول على رابط عام دائم

متطلبات سريعة:
- حساب GitHub
- حساب على Render (render.com)
- المشروع جاهز في مجلد `AuraFrance` مع `package.json`

1) جهّز المستودع محلياً

افتح PowerShell في مجلد `AuraFrance` ثم شغّل:

```powershell
git init
git add .
git commit -m "Initial commit - AuraFrance v6"
```

2) ادفع المشروع إلى GitHub

- أنشئ مستودع جديد على GitHub (مثلاً `AuraFrance-v6`).
- تابع التعليمات على GitHub لربط الريبو ثم ادفع:

```powershell
git remote add origin https://github.com/<your-user>/<repo>.git
git branch -M main
git push -u origin main
```

3) إعداد خدمة على Render

- على Render: "New" → "Web Service" → Connect account → اختر الريبو.
- Branch: `main`.
- Environment: `Node`.
- Build Command: `npm install`.
- Start Command: `npm start`.
- Instance Type: اختر المجاني أو المدفوع حسب حاجتك.

4) متغيرات البيئة (Environment Variables)

أضف المتغيرات التالية في صفحة Service > Environment:

- `JWT_SECRET` = (قيمة سرية طويلة)
- `JWT_REFRESH_SECRET` = (قيمة سرية طويلة)
- `ADMIN_ID`, `ADMIN_PASSWORD`, `ADMIN_NAME`
- `PORT` = `3000` (أو اترك Render يضبطه تلقائياً)
- `TRONGRID_API_KEY` = (إن لزم)

ملاحظة: لا ترفع ملف `.env` إلى GitHub.

5) ملفات مهمة ومساعدة
- استخدم [ecosystem.config.js](ecosystem.config.js) إذا أردت PM2 محلياً.
- اطلع على [RUNNING.md](RUNNING.md) لملاحظات التشغيل والمحلي.

6) اختبار الرابط العام

- بعد الإعداد سيعطيك Render رابطاً عاماً بنطاق `https://<service>.onrender.com`.
- افتح الرابط في المتصفح وتأكد من أن الصفحة الرئيسية (`/`) تظهر.
- تحقق من واجهة API مثلاً:

```powershell
curl https://<service>.onrender.com/api/packages
```

7) ربط دومين مخصص وHTTPS

- في Render: Service → Settings → Custom Domains → Add Domain.
- اتبع تعليمات DNS (A / CNAME) لدى مسجّل النطاق.
- Render يزوّد SSL تلقائياً عبر Let's Encrypt.

بدائل: Railway أو Vercel تعمل بطريقة مشابهة — ارفع الريبو واضبط أوامر البناء والتشغيل.

إذا تريد الآن، أستطيع:
- توليد أوامر Git جاهزة مع استبدال `<your-user>` و`<repo>` (أرسل اسم المستخدم والريبو). 
- أو أجهز ملف `render.yaml` أو إعداد GitHub Actions لنشر تلقائي.
