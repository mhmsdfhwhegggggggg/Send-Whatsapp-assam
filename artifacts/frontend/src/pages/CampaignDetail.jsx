import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Clock, AlertCircle } from "lucide-react";

const statusIcon = (s) => {
  if (s === "sent") return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
  if (s === "failed") return <AlertCircle className="w-4 h-4 text-red-600" />;
  return <Clock className="w-4 h-4 text-amber-500" />;
};
const statusLabel = (s) => ({ sent: "تم الإرسال", failed: "فشل", pending: "بانتظار" }[s] || s);

export default function CampaignDetail() {
  const { id } = useParams();
  const [c, setC] = useState(null);

  const load = () => api.get(`/campaigns/${id}`).then(r => setC(r.data));
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [id]);

  if (!c) return <div className="text-slate-500">جاري التحميل...</div>;
  const pct = c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0;

  return (
    <div className="space-y-6" data-testid="campaign-detail-page">
      <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#1B7A3D]">
        <ArrowRight className="w-4 h-4" /> العودة للحملات
      </Link>

      <header>
        <h1 className="font-heading text-3xl font-black">{c.name}</h1>
        <p className="text-sm text-slate-500 mt-1">حالة: <span className="font-semibold">{c.status}</span></p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-5"><div className="text-sm text-slate-500">إجمالي</div><div className="font-heading text-2xl font-black tabular-nums mt-1">{c.total}</div></Card>
        <Card className="p-5"><div className="text-sm text-slate-500">تم الإرسال</div><div className="font-heading text-2xl font-black tabular-nums mt-1 text-emerald-700">{c.sent}</div></Card>
        <Card className="p-5"><div className="text-sm text-slate-500">فشل</div><div className="font-heading text-2xl font-black tabular-nums mt-1 text-red-600">{c.failed}</div></Card>
        <Card className="p-5"><div className="text-sm text-slate-500">بانتظار</div><div className="font-heading text-2xl font-black tabular-nums mt-1 text-amber-600">{c.pending}</div></Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">التقدم الإجمالي</span>
          <span className="text-sm tabular-nums font-bold">{pct}%</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-l from-[#1B7A3D] to-[#22A055] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Card>

      <Card className="border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100"><h3 className="font-heading font-bold">آخر الرسائل (أحدث 500)</h3></div>
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-right sticky top-0">
              <tr>
                <th className="px-4 py-2 font-semibold">الاسم</th>
                <th className="px-4 py-2 font-semibold">الهاتف</th>
                <th className="px-4 py-2 font-semibold">الحالة</th>
                <th className="px-4 py-2 font-semibold">وقت الإرسال</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {c.messages?.map(m => (
                <tr key={m.id}>
                  <td className="px-4 py-2">{m.name}</td>
                  <td className="px-4 py-2 tabular-nums" dir="ltr">{m.phone}</td>
                  <td className="px-4 py-2"><div className="flex items-center gap-1.5">{statusIcon(m.status)}<span>{statusLabel(m.status)}</span></div></td>
                  <td className="px-4 py-2 text-xs text-slate-500" dir="ltr">{m.sent_at ? new Date(m.sent_at).toLocaleString("ar-EG") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
