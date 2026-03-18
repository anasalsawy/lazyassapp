import { useState, useEffect, useCallback } from "react";
import { Monitor, Maximize2, Minimize2, RefreshCw, Wifi, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface VMViewerProps {
  vmName: string;
  noVNCUrl: string | null;
  status: "online" | "offline";
  onClose: () => void;
}

export function VMViewer({ vmName, noVNCUrl, status, onClose }: VMViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  const refresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  return (
    <div
      className={`border border-border/60 rounded-xl overflow-hidden bg-card/50 backdrop-blur transition-all ${
        isExpanded ? "fixed inset-4 z-50 shadow-2xl" : "w-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium truncate max-w-[200px]">{vmName}</span>
          <Badge
            variant="outline"
            className={`text-xs ${
              status === "online"
                ? "border-green-500/50 text-green-400"
                : "border-destructive/50 text-destructive"
            }`}
          >
            {status === "online" ? (
              <Wifi className="w-3 h-3 mr-1" />
            ) : (
              <WifiOff className="w-3 h-3 mr-1" />
            )}
            {status}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Stream */}
      <div className={`bg-black ${isExpanded ? "h-[calc(100%-40px)]" : "h-[400px]"}`}>
        {noVNCUrl && status === "online" ? (
          <iframe
            key={iframeKey}
            src={noVNCUrl}
            className="w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            title={`VM: ${vmName}`}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <Monitor className="w-12 h-12 opacity-30" />
            <p className="text-sm">
              {status === "offline"
                ? "VM is offline — start it to connect"
                : "No live stream URL configured"}
            </p>
            <p className="text-xs opacity-60">
              Set up noVNC on your Windows VM for live desktop streaming
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
