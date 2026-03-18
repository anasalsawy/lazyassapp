import { Terminal, CheckCircle2, XCircle } from "lucide-react";

interface VMCommandOutputProps {
  command: string;
  output: string;
  exitCode?: number;
  vmName: string;
  durationMs?: number;
}

export function VMCommandOutput({ command, output, exitCode, vmName, durationMs }: VMCommandOutputProps) {
  const success = exitCode === 0 || exitCode === undefined;

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden bg-card/30 my-2">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/30">
        <Terminal className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-mono text-muted-foreground">{vmName}</span>
        {success ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-destructive ml-auto" />
        )}
        {durationMs !== undefined && (
          <span className="text-xs text-muted-foreground">{durationMs}ms</span>
        )}
      </div>

      {/* Command */}
      <div className="px-3 py-1.5 bg-muted/10 border-b border-border/20">
        <code className="text-xs text-primary font-mono">PS&gt; {command}</code>
      </div>

      {/* Output */}
      {output && (
        <div className="px-3 py-2 max-h-[300px] overflow-y-auto">
          <pre className="text-xs text-foreground/80 font-mono whitespace-pre-wrap leading-relaxed">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
