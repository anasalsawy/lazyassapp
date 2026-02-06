import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { OptimizationResult, Scorecard } from "@/hooks/useResumeOptimizer";
import {
  Sparkles,
  FileText,
  Code,
  Download,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Award,
} from "lucide-react";

interface OptimizationResultViewProps {
  result: OptimizationResult;
  onReset: () => void;
  onDownloadText: () => void;
  onDownloadHtml: () => void;
}

export function OptimizationResultView({
  result,
  onReset,
  onDownloadText,
  onDownloadHtml,
}: OptimizationResultViewProps) {
  const [activeTab, setActiveTab] = useState<string>("preview");
  const sc = result.scorecard;

  return (
    <div className="space-y-6">
      {/* Score summary */}
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-success/10 flex items-center justify-center">
                <Award className="w-6 h-6 text-success" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Optimization Complete</h3>
                <p className="text-sm text-muted-foreground">
                  {result.rounds_completed} refinement{" "}
                  {result.rounds_completed === 1 ? "round" : "rounds"} • Target:{" "}
                  {result.target_role}
                </p>
              </div>
            </div>
            <ScoreBadge score={sc.overall_score} label="Overall" />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <ScoreCard label="Overall" score={sc.overall_score} />
            <ScoreCard label="ATS Ready" score={sc.ats_score} />
            <ScoreCard label="Keywords" score={sc.keyword_coverage_score} />
            <ScoreCard label="Clarity" score={sc.clarity_score} />
          </div>

          {/* Praise */}
          {sc.praise && sc.praise.length > 0 && (
            <div className="mt-4 space-y-2">
              {sc.praise.map((p, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-success"
                >
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          )}

          {/* Warnings */}
          {sc.truth_violations && sc.truth_violations.length > 0 && (
            <div className="mt-4 space-y-2">
              {sc.truth_violations.map((v, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-destructive"
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{v}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content tabs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-5 h-5 text-primary" />
            Optimized Resume
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="preview" className="gap-2">
                <Code className="w-4 h-4" />
                Preview
              </TabsTrigger>
              <TabsTrigger value="text" className="gap-2">
                <FileText className="w-4 h-4" />
                ATS Text
              </TabsTrigger>
              <TabsTrigger value="changes" className="gap-2">
                <TrendingUp className="w-4 h-4" />
                Changes
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preview" className="mt-4">
              <div className="border rounded-lg overflow-hidden bg-white">
                <iframe
                  srcDoc={result.html}
                  className="w-full min-h-[600px] border-0"
                  title="Resume Preview"
                  sandbox="allow-same-origin"
                />
              </div>
            </TabsContent>

            <TabsContent value="text" className="mt-4">
              <ScrollArea className="h-[500px] w-full rounded-lg border bg-muted/50 p-4">
                <pre className="text-sm whitespace-pre-wrap font-mono">
                  {result.ats_text}
                </pre>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="changes" className="mt-4">
              <ScrollArea className="h-[500px] w-full">
                <div className="space-y-3">
                  {result.changelog ? (
                    result.changelog.split("\n").filter(Boolean).map((line, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 p-3 rounded-lg bg-success/5 border border-success/20"
                      >
                        <CheckCircle2 className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                        <span className="text-sm">
                          {line.replace(/^[-•*]\s*/, "")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No changelog available
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>

          <div className="flex justify-between items-center gap-3 mt-6 pt-4 border-t">
            <Button variant="outline" onClick={onReset} className="gap-2">
              <RotateCcw className="w-4 h-4" />
              Start Over
            </Button>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onDownloadText} className="gap-2">
                <Download className="w-4 h-4" />
                Download Text
              </Button>
              <Button onClick={onDownloadHtml} className="gap-2">
                <Download className="w-4 h-4" />
                Download HTML
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreCard({ label, score }: { label: string; score: number }) {
  const color =
    score >= 90
      ? "text-success"
      : score >= 75
      ? "text-amber-600"
      : "text-destructive";
  return (
    <div className="text-center p-3 rounded-lg bg-muted/50">
      <p className={`text-2xl font-bold ${color}`}>{score}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const variant = score >= 90 ? "text-success border-success" : "text-amber-600 border-amber-400";
  return (
    <Badge variant="outline" className={`text-lg px-3 py-1 ${variant}`}>
      {score}%
    </Badge>
  );
}
