import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import api from "@/lib/api";
import { ArrowRight, CheckCircle2, Clock, AlertCircle } from "lucide-react";

interface Message { id: string; name: string; phone: string; status: string; sentAt?: string; error?: string; }
interface Campaign {
  id: string; name: string; status: string;
  total: number; sent: number; failed: number; pending: number;
  messages: Message[];
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<Campaign | null>(null);

  useEffect(() => {
    if (!id) return;
    const load = () => api.get(`/campaigns/${id}`).then(r => setC(r.data as Campaign)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [id]);

  if (!c) return <div className="text-slate-500 py-16 text-center">جاري التحميل...</div>;
  const pct = c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Link href="/campaigns">
        <a className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#1B7A3D]">
          <ArrowRight className="w-4 h-4" /> العودة للحملات
        </a>
      </Link>

      <header>
        <h1 className="text-3xl font-black">{c.name}</h1>
        <p className="text-sm text-slate-500 mt-1">الحالة: <span className="font-semibold">{c.status}</span></p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "إجمالي", value: c.total, color: "text-slate-900" },
          { label: "تم الإرسال", value: c.sent, color: "text-emerald-700" },
          { label: "فشل", value: c.failed, color: "text-red-600" },
          { label: "بانتظار", value: c.pending, color: "text-amber-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="text-sm text-slate-500">{label}</div>
            <div className={`text-2xl font-black tabular-nums mt-1 ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">التقدم الإجمالي</span>
          <span className="text-sm tabular-nums font-bold">{pct}%</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-l from-[#1B7A3D] to-[#22A055] transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 font-bold">آخر الرسائل (أحدث 500)</div>
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-right sticky top-0">
              <tr>
                <th className="px-4 py-2 font-semibold">الاسم</th>
                <th className="px-4 py-2 font-semibold">الهاتف</th>
                <th className="px-4 py-2 font-semibold">الحالة</th>
                <th className="px-4 py-2 font-semibold hidden md:table-cell">وقت الإرسال</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {c.messages?.map(m => (
                <tr key={m.id}>
                  <td className="px-4 py-2">{m.name}</td>
                  <td className="px-4 py-2 tabular-nums" dir="ltr">{m.phone}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {m.status === "sent" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> :
                       m.status === "failed" ? <AlertCircle className="w-4 h-4 text-red-600" /> :
                       <Clock className="w-4 h-4 text-amber-500" />}
                      <span>{{ sent: "تم الإرسال", failed: "فشل", pending: "بانتظار" }[m.status] ?? m.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500 hidden md:table-cell" dir="ltr">
                    {m.sentAt ? new Date(m.sentAt).toLocaleString("ar-EG") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
