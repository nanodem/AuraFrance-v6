تشغيل وتشغيل دائم لتطبيق AuraFrance

المتطلبات:
- Node.js >= 18
- npm
- حساب على مزود استضافة (اختياري) مثل Render أو Railway أو Vercel

إعداد محلي سريع:
1. افتح موجه PowerShell في مجلد المشروع (`AuraFrance`).
2. ثبّت الحزم:
```powershell
npm install
```
3. أنشئ ملف `.env` في نفس المجلد مع المتغيرات الأساسية:
```
JWT_SECRET=change_this
JWT_REFRESH_SECRET=change_this
ADMIN_ID=admin
ADMIN_PASSWORD=secret
ADMIN_NAME=Admin
PORT=3000
```
4. شغل محلياً (اختبار):
```powershell
npm start
```

تشغيل دايم باستخدام PM2 (نوصي بالخيار هذا على لينكس/ويندوز):
1. ثبّت PM2 عالمياً:
```powershell
npm install -g pm2
```
2. ابدأ التطبيق عبر ملف الإعداد المرفق:
```powershell
pm2 start ecosystem.config.js --env production
```
3. احفظ حالة العمليات لبدء تلقائي بعد إعادة تشغيل الخادم:
```powershell
pm2 save
pm2 startup
```
4. على Windows استخدم `pm2-windows-service` لتشغيل PM2 كخدمة:
```powershell
npm install -g pm2-windows-service
pm2-service-install -n PM2
pm2 start ecosystem.config.js --env production
pm2 save
```

نشر سريع إلى Render (يعطي رابط عام دائم وHTTPS):
1. ادفع المشروع إلى GitHub.
2. في Render أنشئ "Web Service" وحدد الفرع، واضبط "Build Command" على `npm install` و"Start Command" على `npm start`.
3. أضف متغيرات البيئة (.env) في إعدادات الخدمة على Render.

بدائل:
- Railway/Vercel: خطوات مشابهة — اربط المستودع واضبط أوامر build/start.
- Cloudflare Tunnel: يعطي نطاق دائم دون كشف IP، لكن يتطلب حساب Cloudflare.

ملاحظات أمنية:
- استخدم كلمات سر قوية و`JWT_SECRET` عشوائي.
- لا تترك `ADMIN_PASSWORD` على القيمة الافتراضية في الإنتاج.

إذا تريد، أستطيع تنفيذ أحد المسارات التالية الآن:
- إعداد PM2 وتشغيل محلياً (أحتاج إذنك لتشغيل أوامر محلياً على جهازك)
- تجهيز Git repo وملفات للدفع إلى Render مع خطوات تفصيلية
- إعداد خدمة Windows آلية (PowerShell script) للتشغيل الدائم
