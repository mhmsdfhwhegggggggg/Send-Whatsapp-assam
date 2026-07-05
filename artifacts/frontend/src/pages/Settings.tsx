import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Save, ShieldAlert, ShieldCheck, Flame, Zap, Clock, RotateCcw, Eye, EyeOff } from "lucide-react";

interface Settings {
  new_account_daily_limit:  number;
  warm_account_daily_limit: number;
  hot_account_daily_limit:  number;
  warm_up_days_threshold:   number;
  hot_days_threshold:       number;
  hot_reply_threshold:      number;
  working_hours_start:      number;
  working_hours_end:        number;
  max_retries:              number;
  retry_delay_min:          number;
  spintax_enabled:          boolean;
  invisible_chars_enabled:  boolean;
  kill_switch:              boolean;
  dedup_window_days:        number;
}

export default function Settings() {
  const [s, setS]           = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.get("/settings").then((r) => setS(r.data as Settings));
  }, []);

  if (!s) return <div className="text-slate-400 p-8">جاري التحميل...</div>;

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings", s);
      toast.success("تم حفظ الإعدادات");
    } catch {
      toast.error("فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const toggleKillSwitch = async () => {
    const next = !s.kill_switch;
    if (next && !window.confirm("⚠️ تأكيد: سيتم إيقاف جميع الحملات الجارية فوراً. هل أنت متأكد؟")) return;
    setToggling(true);
    try {
      await api.post("/kill-switch", { active: next });
      setS({ ...s, kill_switch: next });
      toast[next ? "warning" : "success"](
        next ? "🔴 Kill Switch مُفعَّل — كل الحملات متوقفة" : "✅ Kill Switch مُلغى — يمكن تشغيل الحملات",
      );
    } catch {
      toast.error("فشل تغيير Kill Switch");
    } finally {
      setToggling(false);
    }
  };

  const inputCls = "w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D] bg-white";
  const Toggle = ({ field }: { field: keyof Settings }) => (
    <button
      onClick={() => setS({ ...s, [field]: !(s as Record<string, unknown>)[field] })}
      className={`relative w-11 h-6 rounded-full transition-colors ${(s as Record<string, unknown>)[field] ? "bg-[#1B7A3D]" : "bg-slate-200"}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${(s as Record<string, unknown>)[field] ? "translate-x-0.5" : "translate-x-5"}`} />
    </button>
  );

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      <header>
        <h1 className="text-3xl font-black">الإعدادات</h1>
        <p className="text-sm text-slate-500 mt-1">إدارة حدود الإرسال والحماية من الحظر</p>
      </header>

      {/* ── Kill Switch ─────────────────────────────────────────────── */}
      <div className={`rounded-xl border-2 p-5 flex items-center justify-between gap-4 ${s.kill_switch ? "border-red-400 bg-red-50" : "border-slate-200 bg-white"}`}>
        <div className="flex items-center gap-3">
          {s.kill_switch
            ? <ShieldAlert className="w-8 h-8 text-red-600 shrink-0" />
            : <ShieldCheck className="w-8 h-8 text-emerald-600 shrink-0" />}
          <div>
            <div className="font-bold text-base">{s.kill_switch ? "🔴 وضع الطوارئ مُفعَّل" : "🟢 النظام يعمل"}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {s.kill_switch
                ? "جميع الحملات متوقفة. اضغط لإلغاء التجميد."
                : "اضغط لإيقاف كل الحملات فوراً في حالة الطوارئ."}
            </div>
          </div>
        </div>
        <button
          onClick={toggleKillSwitch}
          disabled={toggling}
          className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-colors ${s.kill_switch ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}`}
        >
          {toggling ? "..." : s.kill_switch ? "إلغاء الإيقاف" : "إيقاف طارئ"}
        </button>
      </div>

      {/* ── Tiered Daily Limits ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Flame className="w-5 h-5 text-orange-500" />
          <h2 className="font-bold text-base">حدود الإرسال اليومية (حسب مرحلة الحساب)</h2>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "🆕 حساب جديد", key: "new_account_daily_limit" as const, color: "text-blue-700", desc: `أقل من ${s.warm_up_days_threshold} يوم` },
            { label: "🌱 حساب دافئ", key: "warm_account_daily_limit" as const, color: "text-amber-700", desc: `${s.warm_up_days_threshold}–${s.hot_days_threshold} يوم` },
            { label: "🔥 حساب ساخن", key: "hot_account_daily_limit" as const, color: "text-red-700", desc: `+${s.hot_days_threshold} يوم + ${s.hot_reply_threshold} رد` },
          ].map(({ label, key, color, desc }) => (
            <div key={key} className="text-center space-y-1.5">
              <div className={`text-xs font-semibold ${color}`}>{label}</div>
              <input
                type="number" min={1} max={500}
                value={s[key]}
                onChange={(e) => setS({ ...s, [key]: +e.target.value })}
                className={inputCls + " text-center font-bold text-lg"}
              />
              <div className="text-xs text-slate-400">{desc}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 leading-relaxed">
          <strong>كيف يعمل نظام التدرج:</strong> كل حساب جديد يبدأ بـ {s.new_account_daily_limit} رسالة/يوم.
          بعد {s.warm_up_days_threshold} أيام يرتفع إلى {s.warm_account_daily_limit}.
          بعد {s.hot_days_threshold} يوماً مع {s.hot_reply_threshold}+ ردود يصل إلى {s.hot_account_daily_limit}.
          هذا يحاكي السلوك الطبيعي ويقلل الحظر.
        </div>
      </div>

      {/* ── Warm-Up Thresholds ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Zap className="w-5 h-5 text-yellow-500" />
          <h2 className="font-bold text-base">حدود الانتقال بين المراحل</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">أيام للمرحلة الدافئة</label>
            <input type="number" min={1} value={s.warm_up_days_threshold}
              onChange={(e) => setS({ ...s, warm_up_days_threshold: +e.target.value })}
              className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">أيام للمرحلة الساخنة</label>
            <input type="number" min={1} value={s.hot_days_threshold}
              onChange={(e) => setS({ ...s, hot_days_threshold: +e.target.value })}
              className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">ردود للمرحلة الساخنة</label>
            <input type="number" min={1} value={s.hot_reply_threshold}
              onChange={(e) => setS({ ...s, hot_reply_threshold: +e.target.value })}
              className={inputCls} />
          </div>
        </div>
      </div>

      {/* ── Working Hours ───────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Clock className="w-5 h-5 text-blue-500" />
          <h2 className="font-bold text-base">ساعات العمل</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">بداية الإرسال (24h)</label>
            <input type="number" min={0} max={23} value={s.working_hours_start}
              onChange={(e) => setS({ ...s, working_hours_start: +e.target.value })}
              className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">نهاية الإرسال (24h)</label>
            <input type="number" min={0} max={24} value={s.working_hours_end}
              onChange={(e) => setS({ ...s, working_hours_end: +e.target.value })}
              className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">أقصى محاولات إعادة الإرسال</label>
            <input type="number" min={0} max={10} value={s.max_retries}
              onChange={(e) => setS({ ...s, max_retries: +e.target.value })}
              className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">تأخير إعادة المحاولة (دقيقة)</label>
            <input type="number" min={1} value={s.retry_delay_min}
              onChange={(e) => setS({ ...s, retry_delay_min: +e.target.value })}
              className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">نافذة منع التكرار (أيام)</label>
          <input type="number" min={1} max={90} value={s.dedup_window_days}
            onChange={(e) => setS({ ...s, dedup_window_days: +e.target.value })}
            className={inputCls + " max-w-xs"} />
          <p className="text-xs text-slate-400 mt-1">لا يُرسَل لنفس الرقم أكثر من مرة خلال هذه الفترة</p>
        </div>
      </div>

      {/* ── Anti-Ban Toggles ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Eye className="w-5 h-5 text-purple-500" />
          <h2 className="font-bold text-base">تقنيات مكافحة الحظر</h2>
        </div>
        {[
          { key: "spintax_enabled" as const, label: "تفعيل Spintax", desc: "تنويع نصوص الرسائل تلقائياً باستخدام {خيار1|خيار2}" },
          { key: "invisible_chars_enabled" as const, label: "إضافة رموز شفافة", desc: "إدراج zero-width chars لتنويع البصمة الرقمية لكل رسالة" },
        ].map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between p-3.5 rounded-lg bg-slate-50 border border-slate-100">
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
            </div>
            <Toggle field={key} />
          </div>
        ))}
      </div>

      {/* ── Save button ─────────────────────────────────────────────── */}
      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 px-8 py-3 rounded-lg bg-[#1B7A3D] text-white font-semibold hover:bg-[#145D2E] transition-colors disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
      </button>
    </div>
  );
}
