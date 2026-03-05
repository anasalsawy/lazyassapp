import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Monitor, Maximize2, Minimize2, ExternalLink } from "lucide-react";

interface SteelSessionEmbedProps {
  debugUrl: string;
  sessionId?: string;
  interactive?: boolean;
}

export function SteelSessionEmbed({ debugUrl, sessionId, interactive = false }: SteelSessionEmbedProps) {
  const [expanded, setExpanded] = useState(false);

  const embedUrl = `${debugUrl}?interactive=${interactive}`;

  return (
    <div className="my-3 rounded-xl border border-border/60 overflow-hidden bg-card/50">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-foreground/80">Live Browser Session</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-green-500/10 text-green-400 border-green-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse inline-block" />
            LIVE
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => window.open(embedUrl, "_blank")}
          >
            <ExternalLink className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* iframe */}
      <iframe
        src={embedUrl}
        className="w-full border-0"
        style={{ height: expanded ? "80vh" : "400px" }}
        allow="autoplay; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />

      {sessionId && (
        <div className="px-3 py-1.5 bg-muted/20 border-t border-border/30">
          <span className="text-[10px] text-muted-foreground font-mono">
            session: {sessionId.slice(0, 12)}…
          </span>
        </div>
      )}
    </div>
  );
}
