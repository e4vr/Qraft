# Qraft architecture

هذه الوثيقة تصف البنية الفعلية بعد تأسيس مسار الـPilot منخفض التكلفة. الهدف هو تطوير النظام تدريجيًا دون Full Rewrite أو تغيير معرّفات أو حذف بيانات قديمة.

## 1. كيف يعمل النظام الآن

Qraft تطبيق React 19 وTypeScript يعمل عبر vinext/Vite على Cloudflare Workers. الواجهة PWA، والبيانات المنظمة في D1، والملفات الجديدة في R2. المصادقة الحالية داخل التطبيق وتستخدم جلسة Cookie آمنة؛ لم تُنقل إلى Supabase لأن النقل الآن يضيف مخاطرة بلا فائدة مباشرة.

المصادر الأساسية للبيانات:

- `AppState`: تقدم الطالب، الاختبارات، الملاحظات الخاصة، والـFlashcards. تحفظ فورًا تقريبًا في IndexedDB، ثم تزامن إلى D1 على دفعات كل 15 ثانية وعند عودة الشبكة أو انتقال التطبيق للخلفية.
- `CollaborationState`: QBanks والعضويات والمقترحات والأسئلة المشتركة. الواجهة ترسل الفروق فقط، والخادم يتحقق من الصلاحيات ثم يستخدم D1 batch.
- الملفات: السجل والمرجع فقط في D1؛ المحتوى الجديد يذهب إلى R2. سجلات ImageKit القديمة تبقى مدعومة كبيانات legacy ولا تُحذف.

## 2. Frontend

- المدخل: `app/page.tsx` ثم `components/medguard-app.tsx`.
- مكونات React لا تتصل بـD1 أو R2 مباشرة.
- `lib/application-services.ts` هو واجهة الخدمات العامة للمصادقة والحالة وQBank والملفات.
- `lib/api-client.ts` هو ناقل HTTP موحد.
- `lib/cloudflare-client.ts` adapter داخلي للتنفيذ الحالي ويمكن استبداله لاحقًا دون تعديل الشاشات.

## 3. API

`app/api/cloudflare/[...path]/route.ts` يوزع الطلبات إلى وحدات الخادم. كل البيانات الخاصة ترجع مع `Cache-Control: no-store`، وكل mutation حساس يتحقق من الجلسة والصلاحية في الخادم. الأخطاء الخام لا تظهر للمستخدم.

## 4. Database

D1/SQLite هو مخزن الـPilot. المخطط في `db/schema.ts` والترحيلات في `drizzle/`. SQL الخاص بالمزود محصور في طبقة الخادم، وليس في React.

الترحيل `0007_pilot_data_foundation.sql` إضافي فقط؛ لا يحذف أعمدة أو جداول أو IDs. يضيف metadata للملفات، جداول إحصاءات مجمعة، وسجلًا أساسياً لمزامنة delta/idempotency مستقبلية. عند حفظ AppState تُحدّث `user_stats` داخل نفس D1 batch. وعند تغير الأسئلة أو المقترحات تُحدّث `qbank_stats` للبنوك المتأثرة فقط.

الترحيل `0009_efficient_d1_access.sql` يستبدل البحث المتكرر بين 99,999 رقم سؤال بعدّاد ذري وfree pool يعيد استخدام الرقم المحرر بأمان. عمليات التعاون تقرأ فقط السجلات المذكورة في change set والبنوك المرتبطة بها، والحذف يبدأ من قائمة المفاتيح ثم يستخدم `idx_records_type_id` بدل correlated full scan. تم التحقق محليًا بـ`EXPLAIN QUERY PLAN` من استخدام `idx_records_type_id` و`idx_records_qbank_type`.

## 5. R2

`lib/storage-service.ts` يعرف `StorageService` ويطبق R2 عبر binding باسم `ASSETS`. بقية التطبيق لا يعتمد على R2 API مباشرة.

سير الرفع:

1. تحقق من الجلسة ودور المستخدم وملكيته/وصوله إلى QBank.
2. رفض الأنواع غير المدعومة أو الصور الأكبر من 10 MB.
3. حساب SHA-256 على bytes، لا على اسم الملف.
4. إرجاع الأصل الموجود بدل تخزين نسخة R2 ثانية للمستخدم والبنك نفسيهما.
5. إنشاء object key ثابت البنية وعشوائي النهاية.
6. رفع bytes إلى R2 ثم كتابة metadata فقط في D1.
7. عند فشل D1 بعد الرفع، يحذف الخادم object الجديد لمنع الملفات اليتيمة.

روابط R2 محمية عبر API وتتحقق من صلاحية QBank. يستخدم الرد ETag و`private, max-age=31536000, immutable` لأن المفتاح لا يعاد استخدامه. لا تستخدم الصور Base64 أو BLOB في D1. التحسين البصري المتقدم متروك لخدمة مستقبلية لأن الضغط العشوائي للصور الطبية قد يضر قيمتها التعليمية.

### Hard free-tier guard

Cloudflare Budget Alerts تنبه فقط ولا توقف الاستخدام. لذلك يفرض `StorageService` سقفًا ذريًا في D1 **قبل** كل عملية R2 ينفذها الموقع:

- التخزين: 3 GiB كحد أقصى.
- Class A: 800,000 عملية لكل دورة فوترة.
- Class B: 8,000,000 عملية لكل دورة فوترة.

هذه السقوف أقل من المجاني عمدًا لترك هامش للوحة Cloudflare وأي عمليات يدوية. `r2_usage_periods` يحتفظ بعدادات الدورة التي تبدأ في اليوم المحدد بـ`R2_BILLING_CYCLE_DAY`. عند بلوغ السقف يرفض Worker العملية قبل وصولها إلى R2. فشل D1 نفسه يؤدي أيضًا إلى منع العملية، وليس السماح بها دون عدّاد. حذف R2 مجاني حسب تسعير Cloudflare، لذلك لا يستهلك عداد Class A.

هذا الضمان يغطي كل عمليات الموقع المارة عبر `StorageService`. العمليات اليدوية من Dashboard أو S3/API token ليست تحت سيطرة التطبيق؛ لا تنشئ R2 API tokens ولا ترفع يدويًا في الإنتاج إذا كان المطلوب ضمان صفر تكلفة على مستوى الحساب.

## 6. Auth

المصادقة الحالية تستخدم `profiles`, `sessions`, PBKDF2، Cookie HttpOnly وMFA للمسؤول الأعلى. الواجهة تصل إليها عبر `AuthService` في `application-services.ts`. يمكن إضافة Supabase adapter لاحقًا، لكن لا حاجة للهجرة في الـPilot.

الأسرار المطلوبة حاليًا هي `ROOT_ADMIN_EMAIL` و`ROOT_ADMIN_SETUP_TOKEN` و`BACKUP_SIGNING_KEY`. `IMAGEKIT_PRIVATE_KEY` اختياري مؤقتًا فقط إذا كانت هناك صور قديمة تحتاج عمليات حذف من ImageKit.

## 7. Exam synchronization

الاختبار يحمل مجموعة `questionIds` ومحتوى الأسئلة الموجود أصلًا في ذاكرة التطبيق؛ الانتقال للسؤال التالي محلي ولا ينشئ request. تغييرات الإجابات وMarked/Progress تحفظ إلى IndexedDB خلال 200ms وتبقى dirty حتى نجاح دفعة المزامنة الدورية. لا توجد write لكل اختيار A/B.

الحالة الحالية تحافظ على صيغة AppState القديمة لتوافق البيانات. فصل `exam_attempts` و`exam_answers` إلى جداول مستقلة ليس آمنًا قبل تنفيذ dual-write/backfill والتحقق من نتائج الاختبارات القديمة؛ انظر Remaining work.

## 8. Flashcard synchronization

البطاقات والجدولة وFSRS تعمل محليًا. الضغط Again/Hard/Good/Easy يحدث محليًا ويضاف إلى سجل المراجعات ثم يدخل نفس مزامنة الدفعات كل 15 ثانية. IndexedDB يسمح باستئناف الجلسة بعد انقطاع أو إغلاق مفاجئ.

## 9. Caching and offline

- Service Worker يخزن App Shell فقط ولا يخزن `/api/*`، لمنع تسرب بيانات حساب بين المستخدمين.
- IndexedDB مفصول بمفتاح المستخدم.
- البيانات الخاصة لا تستخدم public CDN cache.
- R2 objects ذات مفاتيح immutable تستخدم browser private cache وETag.
- عند فشل الشبكة تبقى النسخة المحلية ولا تمسح؛ تعاد المحاولة عند عودة الاتصال.
- Realtime لا يجري polling احتياطيًا دوريًا. التحميل الأول يتم أثناء hydration، ثم التحديث عند mutation حقيقي أو بعد إعادة اتصال كانت قد انقطعت.

## 10. Statistics

`user_stats` يحتوي الأسئلة المجابة والصحيح والخطأ والاختبارات المكتملة ومراجعات البطاقات. `qbank_stats` يحتوي إجمالي/معلق/معتمد، ويحدث فقط للبنك المتأثر. `user_topic_stats` موجود كأساس additive ولم يُفعّل للكتابة بعد حتى لا نشتق topic من نسخة سؤال قد تتغير ونفسد التاريخ.

الواجهة الحالية تحسب عرض Dashboard من AppState المحمل مرة واحدة في الذاكرة، وليس عبر استعلام answers كامل في كل فتح. عند نقل Dashboard إلى API يجب أن يقرأ `user_stats` و`user_topic_stats` فقط.

## 11. Upload workflow

استيراد JSON يحسب SHA-256 في العميل ويمنع الملف نفسه حتى لو تغير اسمه. صور الأسئلة والبطاقات تحسب بصمتها في الخادم قبل R2. الأعمدة `purpose`, `status`, و`expires_at` تسمح بسياسة retention لاحقة، لكن لا يوجد حذف تلقائي الآن حفاظًا على الملفات الحالية.

## 12. Environment variables and bindings

| الاسم | النوع | الغرض |
|---|---|---|
| `DB` | D1 binding | قاعدة `qraft-qbank` |
| `ASSETS` | R2 binding | bucket باسم `qraft-assets` |
| `REALTIME` | Durable Object binding | إشعارات التغييرات المهمة فقط |
| `ROOT_ADMIN_EMAIL` | secret | بريد أول Superadmin |
| `ROOT_ADMIN_SETUP_TOKEN` | secret | رمز إعداد طويل وعشوائي |
| `BACKUP_SIGNING_KEY` | secret | مفتاح HMAC بطول 32 محرفًا على الأقل لتوقيع النسخ الاحتياطية الشخصية والتحقق منها |
| `IMAGEKIT_PRIVATE_KEY` | secret اختياري | حذف ملفات legacy فقط أثناء الانتقال |
| `R2_PUBLIC_URL` | variable اختياري | محجوز لمسار CDN عام مستقبلي؛ الصور الخاصة لا تستخدمه |
| `R2_BILLING_CYCLE_DAY` | variable | يوم بداية دورة R2 الظاهر في Billing؛ حاليًا `7` |
| `R2_STORAGE_CAP_BYTES` | variable | سقف التخزين، لا يمكن رفعه فوق 3 GiB من الإعداد |
| `R2_CLASS_A_MONTHLY_CAP` | variable | سقف الكتابة، لا يمكن رفعه فوق 800,000 |
| `R2_CLASS_B_MONTHLY_CAP` | variable | سقف القراءة، لا يمكن رفعه فوق 8,000,000 |
| `NEXT_PUBLIC_SITE_URL` | variable | عنوان الموقع للبيئة الحالية |

لا تضع secret داخل `wrangler.jsonc` أو `.env.example`.

## 13. Local development

```powershell
Copy-Item .dev.vars.example .dev.vars
npm.cmd install
npm.cmd run db:migrate:local
npm.cmd run dev
```

Wrangler ينشئ D1 وR2 محليين من bindings. غيّر القيم النموذجية في `.dev.vars` ولا ترفع الملف إلى Git.

## 14. Deployment

نفّذ بالترتيب، ولا تشغّل أي حذف أو إعادة إنشاء للموارد:

```powershell
npx wrangler r2 bucket create qraft-assets
npx wrangler secret put ROOT_ADMIN_EMAIL
npx wrangler secret put ROOT_ADMIN_SETUP_TOKEN
npx wrangler secret put BACKUP_SIGNING_KEY
npx wrangler d1 migrations apply qraft-qbank --remote
npm.cmd run build
npm.cmd run deploy:realtime
npm.cmd run deploy:app
```

إذا كان bucket موجودًا، لا تعِد إنشاءه؛ اكتفِ بالتأكد أن `wrangler.jsonc` binding يطابق اسمه. خذ D1 export قبل تطبيق migrations في الإنتاج. لا يلزم `CLOUDFLARE_ACCOUNT_ID` داخل Worker لأن D1/R2 يستخدمان bindings مباشرة. أضف `database_id` إلى إعداد بيئة الإنتاج فقط إذا كان نشر المشروع لا يقوم بالـprovisioning التلقائي، واستخدم ID قاعدة D1 الحالية حتى لا تنشئ قاعدة جديدة.

### Question disaster recovery

- D1 Time Travel provides the first recovery layer for recent database incidents.
- The main Worker creates a private, gzip-compressed question snapshot in R2 every day at 01:30 UTC.
- Snapshots include QBank metadata, every published question, stable question IDs, UUIDs, authorship, and timestamps.
- Retention is hard-capped at 14 days and each uncompressed snapshot is hard-capped at 25 MiB. At the maximum, backup storage remains below 350 MiB and uses roughly one R2 write plus one listing per day.
- Backup objects use the `question-backups/` prefix and include an SHA-256 checksum in custom metadata. They are never served by the public media endpoint.
- Before any production migration, also keep a full `wrangler d1 export` outside source control. R2 snapshots protect the question corpus; the D1 export protects the entire application database.

## 15. Monitoring

Workers Observability مفعّل. الأخطاء تسجل كـJSON (`event`, `error`) ولا تحتوي payloads خاصة. D1 batches تقلل عدد round trips، والفهارس الجديدة تغطي قراءة media حسب QBank/hash/expiry والإحصاءات حسب user/QBank. راقب Rows read/returned وRows written من D1، وحجم R2 وعدد أخطاء `cloudflare_api_error` و`realtime_notification_failed`.

خطوط D1 الساخنة مصممة بحيث تكون كلفتها متناسبة مع عدد العناصر المتغيرة، لا مع حجم جدول `records`: حذف 300 عنصر يعني قرابة 300 indexed lookups بدل ضرب 300 في كل صفوف الجدول، وحجز IDs يعني قراءة وكتابة عدد صغير ثابت بدل توليد 99,999 مرشحًا لكل سؤال.

## Remaining work

هذه أعمال مقصودة مؤجلة وليست إعدادات غامضة:

1. `Delta sync`: أضف endpoint يعتمد sequence من `sync_changes`، ثم dual-write من AppState إلى جداول attempts/reviews، ثم backfill واختبار تعارض جهازين. لا توقف مسار AppState القديم قبل نجاح المقارنة.
2. `user_topic_stats`: خزّن snapshot لـ`topic_id` ونتيجة السؤال لحظة grading ثم حدّث الجدول transactionally. لا تحسبه من نص السؤال الحالي لأن التصنيف قابل للمراجعة.
3. `Exam snapshots`: خزّن نص السؤال والخيارات ومفتاح الإجابة أو revision عند إنشاء الاختبار حتى لا تغير مراجعة لاحقة نتيجة اختبار تاريخي.
4. `Image processing`: أضف Worker/Queue منفصلًا للصور غير الطبية فقط، مع خيار “preserve diagnostic quality” للصور الطبية. لا تطبق ضغطًا lossy تلقائيًا على X-ray/CT/pathology.
5. `Temporary documents`: عند إضافة رفع PDF، ضع `purpose='temporary-import'` و`expires_at`، وشغّل cleanup بعد التأكد من نجاح المعالجة وعدم وجود مرجع. لا يطبق على الملفات الحالية.

## Future Scaling Plan

### Phase A — Free Pilot

Workers + D1 + R2 + المصادقة الحالية + IndexedDB. راقب الاستهلاك، احتفظ بالمزامنة المجمعة، ولا تضف microservices أو Realtime عام.

### Phase B — First Revenue

رقِّ خطة Workers، خفّض sampling للسجلات حسب الحجم، أضف Queue لمعالجة الملفات والصور، وفعّل endpoint delta sync والجداول المطبّعة بواسطة dual-write.

### Phase C — Growth

أضف read models للإحصاءات وpagination للأسئلة الكبيرة، وسياسة R2 lifecycle للملفات المؤقتة، واختبارات load للـhot endpoints. يبقى Frontend على نفس interfaces.

### Phase D — Database migration if required

أنشئ `Postgres*Repository` خلف interfaces نفسها، شغّل dual-write ومقارنة checksums، حوّل القراءة Feature Flag، ثم أوقف D1 بعد فترة تحقق. لا تحتاج صفحات React أو UX إلى إعادة كتابة.
