import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  Sparkles,
  ArrowRight,
  Check,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";

interface OptimizationResult {
  originalContent?: string;
  optimizedContent?: string;
  atsScore?: number;
  originalAtsScore?: number;
  improvements?: string[];
  keywords?: string[];
}

interface BeforeAfterPreviewProps {
  optimization: OptimizationResult | null;
  isOptimizing: boolean;
}

export function BeforeAfterPreview({
  optimization,
  isOptimizing,
}: BeforeAfterPreviewProps) {
  const [activeTab, setActiveTab] = useState<"before" | "after" | "changes">(
    "after"
  );

  if (isOptimizing) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4 animate-pulse">
              <Sparkles className="w-8 h-8 text-primary animate-spin" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Optimizing Your Resume</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Our AI is analyzing your resume for ATS compatibility, keyword
              optimization, and professional formatting...
            </p>
            <div className="flex justify-center gap-2 mt-6">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" />
              <div
                className="w-2 h-2 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: "0.1s" }}
              />
              <div
                className="w-2 h-2 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: "0.2s" }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!optimization) {
    return null;
  }

  const scoreImprovement =
    (optimization.atsScore || 0) - (optimization.originalAtsScore || 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Resume Optimization Complete
          </CardTitle>
          {optimization.atsScore && (
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  optimization.atsScore >= 80
                    ? "text-success border-success"
                    : optimization.atsScore >= 60
                    ? "text-warning border-warning"
                    : "text-destructive border-destructive"
                }
              >
                ATS Score: {optimization.atsScore}%
              </Badge>
              {scoreImprovement > 0 && (
                <Badge variant="secondary" className="text-success gap-1">
                  <TrendingUp className="w-3 h-3" />+{scoreImprovement}%
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="before" className="gap-2">
              <FileText className="w-4 h-4" />
              Original
            </TabsTrigger>
            <TabsTrigger value="after" className="gap-2">
              <Sparkles className="w-4 h-4" />
              Optimized
            </TabsTrigger>
            <TabsTrigger value="changes" className="gap-2">
              <Check className="w-4 h-4" />
              Changes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="before" className="mt-4">
            <ScrollArea className="h-64 w-full rounded-lg border bg-muted/50 p-4">
              <pre className="text-sm whitespace-pre-wrap font-mono text-muted-foreground">
                {optimization.originalContent ||
                  "Original resume content not available"}
              </pre>
            </ScrollArea>
            {optimization.originalAtsScore && (
              <div className="mt-4 p-3 rounded-lg bg-destructive/5 border border-destructive/20 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                <span className="text-sm">
                  Original ATS Score: {optimization.originalAtsScore}% - Some
                  improvements recommended
                </span>
              </div>
            )}
          </TabsContent>

          <TabsContent value="after" className="mt-4">
            <ScrollArea className="h-64 w-full rounded-lg border bg-card p-4">
              <pre className="text-sm whitespace-pre-wrap font-mono">
                {optimization.optimizedContent ||
                  "Optimized resume content will appear here"}
              </pre>
            </ScrollArea>
            {optimization.keywords && optimization.keywords.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">Keywords Added:</p>
                <div className="flex flex-wrap gap-2">
                  {optimization.keywords.map((keyword, idx) => (
                    <Badge key={idx} variant="secondary">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="changes" className="mt-4">
            <div className="space-y-3">
              {optimization.improvements && optimization.improvements.length > 0 ? (
                optimization.improvements.map((improvement, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-3 rounded-lg bg-success/5 border border-success/20"
                  >
                    <Check className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{improvement}</span>
                  </div>
                ))
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-success/5 border border-success/20">
                    <Check className="w-4 h-4 text-success mt-0.5" />
                    <span className="text-sm">
                      Added ATS-friendly formatting and structure
                    </span>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-success/5 border border-success/20">
                    <Check className="w-4 h-4 text-success mt-0.5" />
                    <span className="text-sm">
                      Optimized keywords for your target roles
                    </span>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-success/5 border border-success/20">
                    <Check className="w-4 h-4 text-success mt-0.5" />
                    <span className="text-sm">
                      Enhanced bullet points with action verbs and metrics
                    </span>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-success/5 border border-success/20">
                    <Check className="w-4 h-4 text-success mt-0.5" />
                    <span className="text-sm">
                      Improved professional summary for higher engagement
                    </span>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="outline">Download Original</Button>
          <Button className="gap-2">
            <ArrowRight className="w-4 h-4" />
            Use Optimized Version
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
