import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2 } from "lucide-react";

interface OptimizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (targetRole: string, location: string) => void;
  isRunning: boolean;
  resumeTitle: string;
}

export function OptimizeDialog({
  open,
  onOpenChange,
  onStart,
  isRunning,
  resumeTitle,
}: OptimizeDialogProps) {
  const [targetRole, setTargetRole] = useState("");
  const [location, setLocation] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetRole.trim()) return;
    onStart(targetRole.trim(), location.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Optimize Resume
          </DialogTitle>
          <DialogDescription>
            Our AI will analyze, rewrite, and professionally format{" "}
            <strong>{resumeTitle}</strong> for your target role.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="targetRole">Target Role *</Label>
            <Input
              id="targetRole"
              placeholder="e.g. Software Engineer, Marketing Manager"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              disabled={isRunning}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location (optional)</Label>
            <Input
              id="location"
              placeholder="e.g. New York, NY or Remote"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={isRunning}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isRunning}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!targetRole.trim() || isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Optimizing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Start Optimization
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
