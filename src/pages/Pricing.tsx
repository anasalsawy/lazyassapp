 import { useEffect } from "react";
 import { useSearchParams, Link, useNavigate } from "react-router-dom";
 import { useAuth } from "@/hooks/useAuth";
 import { useSubscription, PRICE_IDS } from "@/hooks/useSubscription";
 import { Button } from "@/components/ui/button";
 import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
 import { Badge } from "@/components/ui/badge";
 import { useToast } from "@/hooks/use-toast";
 import { 
   Bot, 
   Briefcase, 
   ShoppingCart, 
   Check, 
   Zap,
   ArrowRight,
   Settings,
   Loader2
 } from "lucide-react";
 
 const Pricing = () => {
   const { user, loading: authLoading } = useAuth();
   const { status, loading: subLoading, startCheckout, openCustomerPortal, checkSubscription, hasJobAgent, hasAutoShop } = useSubscription();
   const [searchParams] = useSearchParams();
   const { toast } = useToast();
   const navigate = useNavigate();
 
   useEffect(() => {
     if (searchParams.get("success") === "true") {
       toast({
         title: "🎉 Subscription Activated!",
         description: "Your subscription is now active. Enjoy the premium features!",
       });
       checkSubscription();
     }
     if (searchParams.get("canceled") === "true") {
       toast({
         title: "Checkout Canceled",
         description: "You can subscribe anytime.",
         variant: "destructive",
       });
     }
   }, [searchParams, toast, checkSubscription]);
 
   const handleSubscribe = async (priceId: string) => {
     if (!user) {
       navigate("/auth");
       return;
     }
     try {
       await startCheckout(priceId);
     } catch (err: any) {
       toast({
         title: "Error",
         description: err.message || "Failed to start checkout",
         variant: "destructive",
       });
     }
   };
 
   const handleManageSubscription = async () => {
     try {
       await openCustomerPortal();
     } catch (err: any) {
       toast({
         title: "Error",
         description: err.message || "Failed to open subscription portal",
         variant: "destructive",
       });
     }
   };
 
   const loading = authLoading || subLoading;
 
   return (
     <div className="min-h-screen bg-background">
       {/* Header */}
       <header className="border-b border-border bg-card/95 backdrop-blur">
         <div className="container max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
           <Link to="/" className="flex items-center gap-2">
             <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
               <Bot className="w-5 h-5 text-primary-foreground" />
             </div>
             <span className="font-bold text-lg">Career Compass</span>
           </Link>
           <div className="flex items-center gap-3">
             {user ? (
               <>
                 <Link to="/dashboard">
                   <Button variant="ghost" size="sm">Dashboard</Button>
                 </Link>
                 {status?.subscribed && (
                   <Button variant="outline" size="sm" onClick={handleManageSubscription}>
                     <Settings className="w-4 h-4 mr-2" />
                     Manage Subscription
                   </Button>
                 )}
               </>
             ) : (
               <Link to="/auth">
                 <Button size="sm">Sign In</Button>
               </Link>
             )}
           </div>
         </div>
       </header>
 
       {/* Main Content */}
       <main className="container max-w-6xl mx-auto px-4 py-16">
         <div className="text-center mb-12">
           <Badge variant="secondary" className="mb-4">Pricing</Badge>
           <h1 className="text-4xl font-bold mb-4">Choose Your AI Assistant</h1>
           <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
             Unlock powerful automation with our AI agents. Subscribe to one or both services based on your needs.
           </p>
         </div>
 
         {loading ? (
           <div className="flex justify-center py-12">
             <Loader2 className="w-8 h-8 animate-spin text-primary" />
           </div>
         ) : (
           <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
             {/* Job Agent Plan */}
             <Card className={`relative ${hasJobAgent ? 'border-primary ring-2 ring-primary/20' : ''}`}>
               {hasJobAgent && (
                 <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                   <Badge className="bg-primary text-primary-foreground">Your Plan</Badge>
                 </div>
               )}
               <CardHeader className="text-center pb-2">
                 <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                   <Briefcase className="w-8 h-8 text-blue-500" />
                 </div>
                 <CardTitle className="text-2xl">Job Agent Pro</CardTitle>
                 <CardDescription>AI-powered job search automation</CardDescription>
               </CardHeader>
               <CardContent className="text-center">
                 <div className="mb-6">
                   <span className="text-4xl font-bold">$50</span>
                   <span className="text-muted-foreground">/month</span>
                 </div>
                 <ul className="space-y-3 text-left">
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>Unlimited job searches</span>
                   </li>
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>Auto-apply to matching jobs</span>
                   </li>
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>AI-generated cover letters</span>
                   </li>
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>Resume optimization & ATS scoring</span>
                   </li>
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>Email monitoring & tracking</span>
                   </li>
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>Application analytics dashboard</span>
                   </li>
                 </ul>
               </CardContent>
               <CardFooter>
                 {hasJobAgent ? (
                   <Button className="w-full" variant="outline" onClick={handleManageSubscription}>
                     <Settings className="w-4 h-4 mr-2" />
                     Manage Plan
                   </Button>
                 ) : (
                   <Button className="w-full" onClick={() => handleSubscribe(PRICE_IDS.JOB_AGENT_MONTHLY)}>
                     <Zap className="w-4 h-4 mr-2" />
                     Subscribe Now
                     <ArrowRight className="w-4 h-4 ml-2" />
                   </Button>
                 )}
               </CardFooter>
             </Card>
 
             {/* Auto-Shop Plan */}
             <Card className={`relative ${hasAutoShop ? 'border-primary ring-2 ring-primary/20' : ''}`}>
               {hasAutoShop && (
                 <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                   <Badge className="bg-primary text-primary-foreground">Your Plan</Badge>
                 </div>
               )}
               <CardHeader className="text-center pb-2">
                 <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                   <ShoppingCart className="w-8 h-8 text-purple-500" />
                 </div>
                 <CardTitle className="text-2xl">Auto-Shop Pro</CardTitle>
                 <CardDescription>Autonomous shopping assistant</CardDescription>
               </CardHeader>
               <CardContent className="text-center">
                 <div className="mb-6">
                   <span className="text-4xl font-bold">$50</span>
                   <span className="text-muted-foreground">/week</span>
                 </div>
                 <ul className="space-y-3 text-left">
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>Unlimited shopping orders</span>
                   </li>
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>AI finds best deals across sites</span>
                   </li>
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>Automatic checkout & purchasing</span>
                   </li>
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>Order tracking & email monitoring</span>
                   </li>
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>Up to 6 concurrent orders</span>
                   </li>
                   <li className="flex items-center gap-2">
                     <Check className="w-5 h-5 text-green-500 shrink-0" />
                     <span>Multi-site account management</span>
                   </li>
                 </ul>
               </CardContent>
               <CardFooter>
                 {hasAutoShop ? (
                   <Button className="w-full" variant="outline" onClick={handleManageSubscription}>
                     <Settings className="w-4 h-4 mr-2" />
                     Manage Plan
                   </Button>
                 ) : (
                   <Button className="w-full" onClick={() => handleSubscribe(PRICE_IDS.AUTO_SHOP_WEEKLY)}>
                     <Zap className="w-4 h-4 mr-2" />
                     Subscribe Now
                     <ArrowRight className="w-4 h-4 ml-2" />
                   </Button>
                 )}
               </CardFooter>
             </Card>
           </div>
         )}
 
         {/* FAQ Section */}
         <div className="mt-20 max-w-3xl mx-auto">
           <h2 className="text-2xl font-bold text-center mb-8">Frequently Asked Questions</h2>
           <div className="space-y-6">
             <div className="p-6 rounded-lg bg-muted/50">
               <h3 className="font-semibold mb-2">Can I subscribe to both services?</h3>
               <p className="text-muted-foreground">Yes! You can subscribe to both Job Agent Pro and Auto-Shop Pro independently. Each subscription is billed separately.</p>
             </div>
             <div className="p-6 rounded-lg bg-muted/50">
               <h3 className="font-semibold mb-2">How do I cancel my subscription?</h3>
               <p className="text-muted-foreground">Click "Manage Subscription" to access the billing portal where you can cancel, pause, or modify your subscription anytime.</p>
             </div>
             <div className="p-6 rounded-lg bg-muted/50">
               <h3 className="font-semibold mb-2">Is there a free trial?</h3>
               <p className="text-muted-foreground">Currently we don't offer free trials, but you can cancel within the first billing period if you're not satisfied.</p>
             </div>
           </div>
         </div>
       </main>
     </div>
   );
 };
 
 export default Pricing;