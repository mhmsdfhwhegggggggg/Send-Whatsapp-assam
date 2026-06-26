import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save } from "lucide-react";

export default function Settings() {
  const [s, setS] = useState(null);

  useEffect(() => { api.get("/settings").then(r => setS(r.data)); }, []);
  if (!s) return <div>...</div>;

  const save = async () => {
    await api.put("/settings", s);
    toast.success("تم الحفظ");
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="settings-page">
      <header>
        <h1 className="font-heading text-3xl font-black">الإعدادات</h1>
        <p className="text-sm text-slate-500 mt-1">ضبط حدود الإرسال وممارسات تقليل الحظر</p>
      </header>

      <Card className="p-6 border-slate-200 space-y-5">
        <div>
          <Label>حد الإرسال اليومي لكل حساب</Label>
          <Input type="number" value={s.daily_limit_per_account} onChange={e => setS({...s, daily_limit_per_account: +e.target.value})} className="text-right mt-1.5 max-w-xs" data-testid="settings-daily-limit" />
          <p className="text-xs text-slate-500 mt-1">يُنصح بـ 500 للحسابات الجديدة، يمكن زيادتها تدريجياً</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>بداية ساعات العمل (24h)</Label>
            <Input type="number" min="0" max="23" value={s.working_hours_start} onChange={e => setS({...s, working_hours_start: +e.target.value})} className="text-right mt-1.5" data-testid="settings-hours-start" />
          </div>
          <div>
            <Label>نهاية ساعات العمل (24h)</Label>
            <Input type="number" min="0" max="24" value={s.working_hours_end} onChange={e => setS({...s, working_hours_end: +e.target.value})} className="text-right mt-1.5" data-testid="settings-hours-end" />
          </div>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
          <div>
            <Label>تفعيل Spintax</Label>
            <p className="text-xs text-slate-500 mt-0.5">تنويع نصوص الرسائل تلقائياً</p>
          </div>
          <Switch checked={s.spintax_enabled} onCheckedChange={v => setS({...s, spintax_enabled: v})} data-testid="settings-spintax" />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
          <div>
            <Label>إضافة رموز خفية</Label>
            <p className="text-xs text-slate-500 mt-0.5">إضافة zero-width chars لتنويع المحتوى</p>
          </div>
          <Switch checked={s.invisible_chars_enabled} onCheckedChange={v => setS({...s, invisible_chars_enabled: v})} data-testid="settings-invisible" />
        </div>
        <Button onClick={save} className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="settings-save">
          <Save className="w-4 h-4 ms-2" /> حفظ الإعدادات
        </Button>
      </Card>
    </div>
  );
}
