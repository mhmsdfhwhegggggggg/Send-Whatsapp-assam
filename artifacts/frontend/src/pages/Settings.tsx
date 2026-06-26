import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Save } from "lucide-react";

interface Settings {
  daily_limit_per_account: number;
  working_hours_start: number;
  working_hours_end: number;
  spintax_enabled: boolean;
  invisible_chars_enabled: boolean;
  max_retries: number;
  retry_delay_min: number;
}

export default function Settings() {
  const [s, setS] = useState<Settings | null>(null);

  useEffect(() => { api.get("/settings").then(r => setS(r.data as Settings)); }, []);
  if (!s) return <div className="text-slate-400">جاري التحميل...</div>;

  const save = async () => {
    await api.put("/settings", s);
    toast.success("تم الحفظ");
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="text-3xl font-black">الإعدادات</h1>
        <p className="text-sm text-slate-500 mt-1">ضبط حدود الإرسال وممارسات تقليل الحظر</p>
      </header>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">حد الإرسال اليومي لكل حساب</label>
          <input type="number" value={s.daily_limit_per_account}
            onChange={e => setS({ ...s, daily_limit_per_account: +e.target.value })}
            className="w-full max-w-xs px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
          <p className="text-xs text-slate-500 mt-1">يُنصح بـ 500 للحسابات الجديدة، يمكن زيادتها تدريجياً</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">بداية ساعات العمل (24h)</label>
            <input type="number" min={0} max={23} value={s.working_hours_start}
              onChange={e => setS({ ...s, working_hours_start: +e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">نهاية ساعات العمل (24h)</label>
            <input type="number" min={0} max={24} value={s.working_hours_end}
              onChange={e => setS({ ...s, working_hours_end: +e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">أقصى عدد محاولات إعادة الإرسال</label>
            <input type="number" min={0} max={10} value={s.max_retries}
              onChange={e => setS({ ...s, max_retries: +e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">تأخير إعادة المحاولة (دقيقة)</label>
            <input type="number" min={1} value={s.retry_delay_min}
              onChange={e => setS({ ...s, retry_delay_min: +e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
          </div>
        </div>

        {[
          { key: "spintax_enabled", label: "تفعيل Spintax", desc: "تنويع نصوص الرسائل تلقائياً" },
          { key: "invisible_chars_enabled", label: "إضافة رموز خفية", desc: "إضافة zero-width chars لتنويع المحتوى" },
        ].map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
            </div>
            <button
              onClick={() => setS({ ...s, [key]: !(s as Record<string, boolean>)[key] })}
              className={`relative w-11 h-6 rounded-full transition-colors ${(s as Record<string, boolean>)[key] ? "bg-[#1B7A3D]" : "bg-slate-200"}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${(s as Record<string, boolean>)[key] ? "translate-x-0.5" : "translate-x-5"}`} />
            </button>
          </div>
        ))}

        <button onClick={save} className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#1B7A3D] text-white font-medium hover:bg-[#145D2E] transition-colors">
          <Save className="w-4 h-4" /> حفظ الإعدادات
        </button>
      </div>
    </div>
  );
}
