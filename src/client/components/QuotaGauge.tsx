/**
 * 免费配额使用率与熔断状态指示仪表盘组件
 */

export interface QuotaGaugeProps {
  title: string;
  usedLabel: string;
  maxLabel: string;
  percent: number;
  isWarning: boolean;
  isCritical: boolean;
  unitDesc?: string;
}

export function QuotaGauge(props: QuotaGaugeProps) {
  // 根据状态计算色彩与样式
  const colorClass = () => {
    if (props.isCritical) return 'bg-rose-500 text-rose-700 border-rose-200';
    if (props.isWarning) return 'bg-amber-500 text-amber-700 border-amber-200';
    return 'bg-emerald-500 text-emerald-700 border-emerald-200';
  };

  const badgeBg = () => {
    if (props.isCritical) return 'bg-rose-50 text-rose-700 border-rose-200';
    if (props.isWarning) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  const statusText = () => {
    if (props.isCritical) return '熔断保护 (≥95%)';
    if (props.isWarning) return '接近上限 (≥80%)';
    return '运行健康';
  };

  return (
    <div class="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 flex flex-col justify-between transition-all hover:shadow-md">
      <div>
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-semibold text-slate-700">{props.title}</span>
          <span class={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${badgeBg()}`}>
            {statusText()}
          </span>
        </div>

        <div class="flex items-baseline gap-2 mb-2">
          <span class="text-2xl font-bold font-mono text-slate-900">
            {props.usedLabel}
          </span>
          <span class="text-xs text-slate-400 font-mono">
            / {props.maxLabel}
          </span>
        </div>
      </div>

      <div class="mt-2">
        <div class="flex justify-between text-xs text-slate-500 mb-1.5 font-medium">
          <span>免费用量占比</span>
          <span class="font-mono font-semibold">{props.percent}%</span>
        </div>
        <div class="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            class={`h-full rounded-full transition-all duration-500 ${colorClass().split(' ')[0]}`}
            style={{ width: `${Math.min(100, Math.max(0, props.percent))}%` }}
          />
        </div>
        {props.unitDesc && (
          <p class="text-[11px] text-slate-400 mt-2">{props.unitDesc}</p>
        )}
      </div>
    </div>
  );
}
