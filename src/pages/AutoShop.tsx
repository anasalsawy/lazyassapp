import { useState, useRef } from "react";
import { useAutoShop } from "@/hooks/useAutoShop";
import { useShopProfile } from "@/hooks/useShopProfile";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Navigate, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Elements } from "@stripe/react-stripe-js";
import { stripePromise } from "@/lib/stripe";
import { StripeCardInput } from "@/components/shop/StripeCardInput";
import { 
  CreditCard, 
  MapPin, 
  ShoppingCart, 
  Plus, 
  Trash2, 
  Loader2, 
  Package, 
  CheckCircle, 
  XCircle, 
  Search, 
  Image, 
  Link as LinkIcon, 
  X, 
  Briefcase,
  Mail,
  ExternalLink,
  Zap,
  Truck,
  Settings,
  Globe,
  Shield
} from "lucide-react";

const SHOP_SITES = [
  { key: "gmail", name: "Gmail", icon: Mail, color: "bg-red-500", description: "Access inbox for codes & shipping updates" },
  { key: "amazon", name: "Amazon", icon: ShoppingCart, color: "bg-orange-500", description: "Shop with saved account" },
  { key: "ebay", name: "eBay", icon: Package, color: "bg-blue-500", description: "Bid and buy items" },
  { key: "walmart", name: "Walmart", icon: ShoppingCart, color: "bg-blue-600", description: "Everyday low prices" },
];

const AutoShop = () => {
  const { user, loading: authLoading } = useAuth();
  const {
    cards,
    addresses,
    orders,
    loading,
    isOwner,
    addCard,
    deleteCard,
    addAddress,
    deleteAddress,
    startOrder,
    cancelOrder,
    getMaskedCardNumber,
    refreshData: refreshOrders,
  } = useAutoShop();
  
  const {
    profile: shopProfile,
    tracking,
    orderEmails,
    isLoading: profileLoading,
    isSyncing,
    isSyncingEmails,
    loginSession,
    createProfile,
    startLogin,
    confirmLogin,
    syncOrders,
    syncOrderEmails,
    setProxy,
    clearProxy,
    testProxy,
  } = useShopProfile();

  const [activeTab, setActiveTab] = useState("shop");
  const [showAddCard, setShowAddCard] = useState(false);
  const [showAddAddress, setShowAddAddress] = useState(false);
  
  // Simplified form states - single text blocks
  const [cardForm, setCardForm] = useState({
    card_name: "",
    card_details: "", // "4111111111111111, 12/25, 123, John Doe"
    billing_details: "", // "123 Main St, City, ST 12345, USA"
  });

  const [addressForm, setAddressForm] = useState({
    address_name: "",
    shipping_details: "", // "John Doe, 123 Main St Apt 4, City, ST 12345, +1-555-1234"
  });

  // Card verification success handler
  const handleCardVerified = (data: { last4: string; brand: string; paymentIntentId: string }) => {
    console.log("[AutoShop] Card verified:", data);
    // Optionally refresh cards list or update UI
  };

  const [orderForm, setOrderForm] = useState({
    product_query: "",
    product_image: null as File | null,
    product_image_preview: "",
    reference_url: "",
    max_price: "",
    quantity: "1",
    shipping_address_id: "",
  });

  // Proxy form state
  const [proxyForm, setProxyForm] = useState({
    server: "",
    username: "",
    password: "",
  });
  const [showProxyDialog, setShowProxyDialog] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [verifyingCard, setVerifyingCard] = useState(false);

  // Function to verify card with Stripe $1 preauthorization
  const verifyCardWithStripe = async (cardDetails: {
    card_number: string;
    expiry: string;
    cvv: string;
    cardholder_name: string;
  }) => {
    try {
      setVerifyingCard(true);
      toast.info("Verifying card with $1.00 preauthorization...");
      
      // Call the card-preauth edge function
      // Note: In production, you'd use Stripe.js to create a PaymentMethod first
      // For now, we'll pass the card details to the edge function
      const { data, error } = await supabase.functions.invoke("card-preauth", {
        body: {
          // In a real implementation, you'd use Stripe.js to tokenize the card
          // and pass the paymentMethodId here. For demo purposes:
          cardNumber: cardDetails.card_number,
          expiry: cardDetails.expiry,
          cvv: cardDetails.cvv,
          cardholderName: cardDetails.cardholder_name,
          email: user?.email,
        },
      });

      if (error) {
        console.error("[CardVerify] Error:", error);
        toast.error("Card verification failed", {
          description: error.message,
        });
        return false;
      }

      if (data?.success) {
        toast.success("Card verified successfully!", {
          description: "A $1.00 hold was placed and will be released shortly.",
        });
        return true;
      } else {
        toast.error("Card verification failed", {
          description: data?.error || "Unable to verify card",
        });
        return false;
      }
    } catch (err: any) {
      console.error("[CardVerify] Exception:", err);
      toast.error("Card verification error", {
        description: err.message,
      });
      return false;
    } finally {
      setVerifyingCard(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Parse card details from single block
  const parseCardDetails = (details: string) => {
    const parts = details.split(",").map(s => s.trim());
    return {
      card_number: parts[0] || "",
      expiry: parts[1] || "",
      cvv: parts[2] || "",
      cardholder_name: parts[3] || "",
    };
  };

  // Parse billing from single block
  const parseBillingDetails = (details: string) => {
    // Simple format: "Address, City, State ZIP, Country"
    return details.trim();
  };

  // Parse shipping from single block
  const parseShippingDetails = (details: string) => {
    const parts = details.split(",").map(s => s.trim());
    // Format: "Full Name, Address Line 1, Address Line 2 (opt), City, State ZIP, Phone (opt)"
    return {
      full_name: parts[0] || "",
      address_line1: parts[1] || "",
      address_line2: parts.length > 5 ? parts[2] : "",
      city: parts.length > 5 ? parts[3] : parts[2] || "",
      state_zip: parts.length > 5 ? parts[4] : parts[3] || "",
      phone: parts[parts.length - 1]?.match(/\+?\d/) ? parts[parts.length - 1] : "",
    };
  };

  const handleAddCard = async () => {
    if (!cardForm.card_name || !cardForm.card_details) return;
    
    setSubmitting(true);
    const parsed = parseCardDetails(cardForm.card_details);
    const billing = parseBillingDetails(cardForm.billing_details);
    
    // Note: The Stripe preauth requires a PaymentMethod ID from Stripe.js
    // For now, we save the card without verification
    // To enable full verification, integrate Stripe Elements on the frontend
    
    await addCard({
      card_name: cardForm.card_name,
      card_number: parsed.card_number,
      expiry: parsed.expiry,
      cvv: parsed.cvv,
      cardholder_name: parsed.cardholder_name,
      billing_address: billing,
    });
    
    setCardForm({ card_name: "", card_details: "", billing_details: "" });
    setShowAddCard(false);
    setSubmitting(false);
  };

  // Verify existing saved card - now handled by Stripe Elements
  const handleVerifyCard = async (card: typeof cards[0]) => {
    toast.info("Use the Stripe card form above to verify cards");
  };
  };

  const handleAddAddress = async () => {
    if (!addressForm.address_name || !addressForm.shipping_details) return;
    
    setSubmitting(true);
    const parsed = parseShippingDetails(addressForm.shipping_details);
    const stateZip = parsed.state_zip.split(" ");
    
    await addAddress({
      address_name: addressForm.address_name,
      full_name: parsed.full_name,
      address_line1: parsed.address_line1,
      address_line2: parsed.address_line2,
      city: parsed.city,
      state: stateZip[0] || "",
      zip_code: stateZip[1] || "",
      country: "US",
      phone: parsed.phone,
      is_default: false,
    });
    
    setAddressForm({ address_name: "", shipping_details: "" });
    setShowAddAddress(false);
    setSubmitting(false);
  };

  const handleStartOrder = async () => {
    if (!orderForm.product_query || !orderForm.shipping_address_id) return;
    
    setSubmitting(true);
    await startOrder({
      product_query: orderForm.product_query,
      max_price: orderForm.max_price ? parseFloat(orderForm.max_price) : undefined,
      quantity: parseInt(orderForm.quantity) || 1,
      shipping_address_id: orderForm.shipping_address_id,
    });
    setOrderForm({
      product_query: "",
      product_image: null,
      product_image_preview: "",
      reference_url: "",
      max_price: "",
      quantity: "1",
      shipping_address_id: orderForm.shipping_address_id,
    });
    setSubmitting(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setOrderForm({
          ...orderForm,
          product_image: file,
          product_image_preview: reader.result as string,
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const clearImage = () => {
    setOrderForm({
      ...orderForm,
      product_image: null,
      product_image_preview: "",
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
      pending: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      searching: { variant: "default", icon: <Search className="h-3 w-3" /> },
      found_deals: { variant: "default", icon: <Package className="h-3 w-3" /> },
      ordering: { variant: "default", icon: <ShoppingCart className="h-3 w-3" /> },
      completed: { variant: "outline", icon: <CheckCircle className="h-3 w-3 text-green-500" /> },
      failed: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
      cancelled: { variant: "secondary", icon: <XCircle className="h-3 w-3" /> },
    };
    const config = statusConfig[status] || statusConfig.pending;
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        {config.icon}
        {status.replace("_", " ").toUpperCase()}
      </Badge>
    );
  };

  return (
    <AppLayout>
      <div className="container max-w-6xl mx-auto py-8 px-4">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">🛒 Auto-Shop</h1>
            <p className="text-muted-foreground mt-1">
              AI-powered shopping agent that finds the best deals and places orders for you
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/jobs">
              <Briefcase className="h-4 w-4 mr-2" />
              Job Agent
            </Link>
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 flex-wrap">
            <TabsTrigger value="shop" className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Shop
            </TabsTrigger>
            <TabsTrigger value="accounts" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Accounts
            </TabsTrigger>
            {isOwner && (
              <TabsTrigger value="cards" className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Cards ({cards.length})
              </TabsTrigger>
            )}
            <TabsTrigger value="addresses" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Addresses ({addresses.length})
            </TabsTrigger>
            <TabsTrigger value="orders" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Orders ({orders.length})
            </TabsTrigger>
            <TabsTrigger value="tracking" className="flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Tracking ({tracking.length})
            </TabsTrigger>
            <TabsTrigger value="emails" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Emails ({orderEmails.length})
            </TabsTrigger>
          </TabsList>

          {/* Shopping Tab */}
          <TabsContent value="shop">
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Start Shopping</CardTitle>
                  <CardDescription>
                    Tell the AI what to buy and it will find the best deal
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Product Name */}
                  <div className="space-y-2">
                    <Label>Product Name</Label>
                    <Textarea
                      placeholder="e.g., iPhone 15 Pro 256GB black, Sony WH-1000XM5 headphones..."
                      value={orderForm.product_query}
                      onChange={(e) => setOrderForm({ ...orderForm, product_query: e.target.value })}
                      rows={2}
                    />
                  </div>

                  {/* Product Image */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Image className="h-4 w-4" />
                      Product Image (optional)
                    </Label>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    {orderForm.product_image_preview ? (
                      <div className="relative inline-block">
                        <img
                          src={orderForm.product_image_preview}
                          alt="Product"
                          className="h-24 w-24 object-cover rounded-md border"
                        />
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute -top-2 -right-2 h-6 w-6"
                          onClick={clearImage}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full"
                      >
                        <Image className="mr-2 h-4 w-4" />
                        Upload Image
                      </Button>
                    )}
                  </div>

                  {/* Reference URL */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <LinkIcon className="h-4 w-4" />
                      Reference URL (optional)
                    </Label>
                    <Input
                      placeholder="https://example.com/product-page (for reference only)"
                      value={orderForm.reference_url}
                      onChange={(e) => setOrderForm({ ...orderForm, reference_url: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Used to identify the product, not to limit shopping sites</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Max Price ($)</Label>
                      <Input
                        type="number"
                        placeholder="500"
                        value={orderForm.max_price}
                        onChange={(e) => setOrderForm({ ...orderForm, max_price: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Quantity</Label>
                      <Input
                        type="number"
                        min="1"
                        value={orderForm.quantity}
                        onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Ship To</Label>
                    <Select
                      value={orderForm.shipping_address_id}
                      onValueChange={(value) => setOrderForm({ ...orderForm, shipping_address_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select shipping address" />
                      </SelectTrigger>
                      <SelectContent>
                        {addresses.map((addr) => (
                          <SelectItem key={addr.id} value={addr.id}>
                            {addr.address_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleStartOrder}
                    disabled={submitting || !orderForm.product_query || !orderForm.shipping_address_id || cards.length === 0}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Start Shopping Agent
                      </>
                    )}
                  </Button>

                  {cards.length === 0 && isOwner && (
                    <p className="text-sm text-destructive text-center">
                      ⚠️ Add at least one payment card first
                    </p>
                  )}
                  {cards.length === 0 && !isOwner && (
                    <p className="text-sm text-destructive text-center">
                      ⚠️ No payment cards available - ask the owner to add one
                    </p>
                  )}
                  {addresses.length === 0 && (
                    <p className="text-sm text-destructive text-center">
                      ⚠️ Add a shipping address first
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>How It Works</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">1</div>
                    <div>
                      <h4 className="font-medium">Search for Deals</h4>
                      <p className="text-sm text-muted-foreground">Searches Google, Amazon, eBay, Walmart & more</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">2</div>
                    <div>
                      <h4 className="font-medium">Compare & Select Best Price</h4>
                      <p className="text-sm text-muted-foreground">Finds lowest price within your budget</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">3</div>
                    <div>
                      <h4 className="font-medium">Auto-Checkout</h4>
                      <p className="text-sm text-muted-foreground">Tries backup cards if one is declined</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">4</div>
                    <div>
                      <h4 className="font-medium">Order Complete</h4>
                      <p className="text-sm text-muted-foreground">Saves confirmation to order history</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Accounts Tab - Connect Email & Shopping Sites */}
          <TabsContent value="accounts">
            <div className="space-y-6">
              {/* Setup Profile Section */}
              {!shopProfile?.hasProfile && (
                <Card className="border-dashed border-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Settings className="h-5 w-5" />
                      Setup Browser Profile
                    </CardTitle>
                    <CardDescription>
                      Create a browser profile to save your login sessions. You'll only need to log in once per site.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button onClick={createProfile} disabled={profileLoading}>
                      {profileLoading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4 mr-2" />
                      )}
                      Create Browser Profile
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Connected Sites */}
              {shopProfile?.hasProfile && (
                <Card>
                  <CardHeader>
                    <CardTitle>Connected Accounts</CardTitle>
                    <CardDescription>
                      Log in to your accounts once. The shopping agent will use these saved sessions for faster checkout and inbox access.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {SHOP_SITES.map((site) => {
                        const isConnected = shopProfile.sitesLoggedIn?.includes(site.key);
                        const Icon = site.icon;
                        const isPending = loginSession?.site === site.key;

                        return (
                          <div
                            key={site.key}
                            className={`p-4 rounded-lg border-2 transition-all ${
                              isConnected 
                                ? "border-green-500 bg-green-500/10" 
                                : "border-muted hover:border-primary"
                            }`}
                          >
                            <div className="flex items-center gap-3 mb-2">
                              <div className={`p-2 rounded-full ${site.color}`}>
                                <Icon className="h-4 w-4 text-white" />
                              </div>
                              <span className="font-medium">{site.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mb-3">{site.description}</p>

                            {isConnected ? (
                              <Badge variant="outline" className="text-green-600 border-green-600">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Connected
                              </Badge>
                            ) : isPending ? (
                              <div className="space-y-2">
                                {loginSession?.liveViewUrl && (
                                  <Button size="sm" variant="outline" asChild className="w-full">
                                    <a href={loginSession.liveViewUrl} target="_blank" rel="noopener noreferrer">
                                      <ExternalLink className="h-3 w-3 mr-1" />
                                      Open Browser
                                    </a>
                                  </Button>
                                )}
                                <Button 
                                  size="sm" 
                                  className="w-full"
                                  onClick={() => confirmLogin(site.key)}
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  I'm Logged In
                                </Button>
                              </div>
                            ) : (
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="w-full"
                                onClick={() => startLogin(site.key)}
                              >
                                Connect
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Custom Proxy Configuration */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    Custom Proxy (Optional)
                  </CardTitle>
                  <CardDescription>
                    Use your own proxy to avoid blocks on shopping sites. Residential proxies work best.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {shopProfile?.proxyServer ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-4 border rounded-lg bg-green-500/10 border-green-500">
                        <div className="flex items-center gap-3">
                          <Shield className="h-5 w-5 text-green-500" />
                          <div>
                            <p className="font-medium">Proxy Active</p>
                            <p className="text-sm text-muted-foreground">{shopProfile.proxyServer}</p>
                            {shopProfile.proxyUsername && (
                              <p className="text-xs text-muted-foreground">Auth: {shopProfile.proxyUsername}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => testProxy()}
                          >
                            <Zap className="h-4 w-4 mr-1" />
                            Test
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => clearProxy()}>
                            Clear
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Click "Test" to verify your proxy is working. This will check your IP through the proxy.
                      </p>
                    </div>
                  ) : (
                    <Dialog open={showProxyDialog} onOpenChange={setShowProxyDialog}>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="w-full">
                          <Globe className="h-4 w-4 mr-2" />
                          Configure Proxy
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Configure Custom Proxy</DialogTitle>
                          <DialogDescription>
                            Enter your proxy details. Residential proxies from providers like BrightData, Oxylabs, or Smartproxy work best.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Proxy Server URL</Label>
                            <Input
                              placeholder="http://proxy.example.com:8080"
                              value={proxyForm.server}
                              onChange={(e) => setProxyForm({ ...proxyForm, server: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">Format: http://host:port or socks5://host:port</p>
                          </div>
                          <div className="space-y-2">
                            <Label>Username (optional)</Label>
                            <Input
                              placeholder="proxy_user"
                              value={proxyForm.username}
                              onChange={(e) => setProxyForm({ ...proxyForm, username: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Password (optional)</Label>
                            <Input
                              type="password"
                              placeholder="proxy_password"
                              value={proxyForm.password}
                              onChange={(e) => setProxyForm({ ...proxyForm, password: e.target.value })}
                            />
                          </div>
                          <Button 
                            onClick={async () => {
                              if (!proxyForm.server) return;
                              await setProxy(proxyForm.server, proxyForm.username, proxyForm.password);
                              setShowProxyDialog(false);
                              setProxyForm({ server: "", username: "", password: "" });
                            }} 
                            className="w-full"
                            disabled={!proxyForm.server}
                          >
                            Save Proxy
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                </CardContent>
              </Card>

              {/* Benefits Info */}
              <Card>
                <CardHeader>
                  <CardTitle>Why Connect Your Accounts?</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <div className="flex gap-3">
                    <Mail className="h-8 w-8 text-red-500 flex-shrink-0" />
                    <div>
                      <h4 className="font-medium">Gmail Access</h4>
                      <p className="text-sm text-muted-foreground">
                        Agent can read verification codes, click confirmation links, and monitor shipping updates
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <ShoppingCart className="h-8 w-8 text-orange-500 flex-shrink-0" />
                    <div>
                      <h4 className="font-medium">Faster Checkout</h4>
                      <p className="text-sm text-muted-foreground">
                        Use saved addresses and payment methods on your accounts
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Truck className="h-8 w-8 text-blue-500 flex-shrink-0" />
                    <div>
                      <h4 className="font-medium">Order Tracking</h4>
                      <p className="text-sm text-muted-foreground">
                        Automatically extract tracking info from confirmation emails
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Cards Tab - Owner Only */}
          {isOwner && (
          <TabsContent value="cards">
            <div className="space-y-6">
              {/* Stripe Card Verification */}
              <Card className="border-primary/50">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Shield className="h-5 w-5" />
                    Verify Card ($1.00 hold)
                  </CardTitle>
                  <CardDescription>
                    Securely verify your card with a $1.00 preauthorization (released automatically in ~7 days)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Elements stripe={stripePromise}>
                    <StripeCardInput 
                      userEmail={user?.email || undefined}
                      onSuccess={handleCardVerified}
                    />
                  </Elements>
                </CardContent>
              </Card>

              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Payment Cards</h2>
                <Dialog open={showAddCard} onOpenChange={setShowAddCard}>
                  <DialogTrigger asChild>
                    <Button><Plus className="mr-2 h-4 w-4" />Add Card</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Payment Card</DialogTitle>
                      <DialogDescription>Card details are encrypted</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Card Nickname</Label>
                        <Input
                          placeholder="e.g., Chase Sapphire"
                          value={cardForm.card_name}
                          onChange={(e) => setCardForm({ ...cardForm, card_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Card Details</Label>
                        <Textarea
                          placeholder="Card Number, Expiry (MM/YY), CVV, Cardholder Name&#10;e.g., 4111111111111111, 12/25, 123, John Doe"
                          value={cardForm.card_details}
                          onChange={(e) => setCardForm({ ...cardForm, card_details: e.target.value })}
                          rows={2}
                        />
                        <p className="text-xs text-muted-foreground">Format: Number, MM/YY, CVV, Name</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Billing Address (optional)</Label>
                        <Textarea
                          placeholder="123 Main St, City, ST 12345, USA"
                          value={cardForm.billing_details}
                          onChange={(e) => setCardForm({ ...cardForm, billing_details: e.target.value })}
                          rows={2}
                        />
                      </div>
                      <Button onClick={handleAddCard} className="w-full" disabled={submitting}>
                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Card
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : cards.length === 0 ? (
                <Card className="py-12">
                  <CardContent className="text-center">
                    <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium text-lg">No payment cards</h3>
                    <p className="text-muted-foreground">Add a card to enable auto-shopping</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {cards.map((card) => (
                    <Card key={card.id}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold">{card.card_name}</h3>
                            <p className="text-lg font-mono">{getMaskedCardNumber(card.card_number_enc)}</p>
                            <p className="text-sm text-muted-foreground">{card.cardholder_name}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleVerifyCard(card)}
                              disabled={verifyingCard}
                            >
                              {verifyingCard ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Shield className="h-4 w-4" />
                              )}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteCard(card.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
          )}

          {/* Addresses Tab */}
          <TabsContent value="addresses">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Shipping Addresses</h2>
                <Dialog open={showAddAddress} onOpenChange={setShowAddAddress}>
                  <DialogTrigger asChild>
                    <Button><Plus className="mr-2 h-4 w-4" />Add Address</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Shipping Address</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Address Nickname</Label>
                        <Input
                          placeholder="e.g., Home, Office"
                          value={addressForm.address_name}
                          onChange={(e) => setAddressForm({ ...addressForm, address_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Shipping Details</Label>
                        <Textarea
                          placeholder="Full Name, Street Address, City, State ZIP, Phone&#10;e.g., John Doe, 123 Main St Apt 4, New York, NY 10001, +1-555-1234"
                          value={addressForm.shipping_details}
                          onChange={(e) => setAddressForm({ ...addressForm, shipping_details: e.target.value })}
                          rows={3}
                        />
                        <p className="text-xs text-muted-foreground">Format: Name, Address, City, State ZIP, Phone</p>
                      </div>
                      <Button onClick={handleAddAddress} className="w-full" disabled={submitting}>
                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Address
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : addresses.length === 0 ? (
                <Card className="py-12">
                  <CardContent className="text-center">
                    <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium text-lg">No shipping addresses</h3>
                    <p className="text-muted-foreground">Add an address to receive your orders</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {addresses.map((addr) => (
                    <Card key={addr.id}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold">{addr.address_name}</h3>
                            <p className="text-sm">{addr.full_name}</p>
                            <p className="text-sm text-muted-foreground">{addr.address_line1}</p>
                            <p className="text-sm text-muted-foreground">{addr.city}, {addr.state} {addr.zip_code}</p>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => deleteAddress(addr.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Orders Tab */}
          <TabsContent value="orders">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Order History</h2>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={async () => {
                    await syncOrders();
                    refreshOrders();
                  }}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <Zap className="mr-2 h-4 w-4" />
                      Refresh Status
                    </>
                  )}
                </Button>
              </div>

              {isSyncing && (
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking order status with shopping agent...
                </div>
              )}

              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : orders.length === 0 ? (
                <Card className="py-12">
                  <CardContent className="text-center">
                    <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium text-lg">No orders yet</h3>
                    <p className="text-muted-foreground">Start shopping to see your orders here</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <Card key={order.id} className={order.status === "completed" ? "border-green-200 dark:border-green-800" : order.status === "failed" ? "border-red-200 dark:border-red-800" : ""}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">{order.product_query}</h3>
                              {getStatusBadge(order.status)}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Qty: {order.quantity}{order.max_price && ` • Max: $${order.max_price}`}
                            </p>
                            {order.selected_deal_site && (
                              <p className="text-sm">
                                Found at: <span className="font-medium">{order.selected_deal_site}</span>
                                {order.selected_deal_price && ` - $${order.selected_deal_price}`}
                              </p>
                            )}
                            {order.order_confirmation && (
                              <p className="text-sm text-green-600">✓ Confirmation: {order.order_confirmation}</p>
                            )}
                            {order.error_message && (
                              <p className="text-sm text-destructive">✗ {order.error_message}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {new Date(order.created_at).toLocaleString()}
                              {order.completed_at && ` • Completed: ${new Date(order.completed_at).toLocaleString()}`}
                            </p>
                          </div>
                          {(order.status === "pending" || order.status === "searching") && (
                            <Button variant="outline" size="sm" onClick={() => cancelOrder(order.id)}>
                              Cancel
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Tracking Tab */}
          <TabsContent value="tracking">
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Shipment Tracking</h2>
              <p className="text-muted-foreground">
                Tracking information extracted from your order confirmation emails
              </p>

              {tracking.length === 0 ? (
                <Card className="py-12">
                  <CardContent className="text-center">
                    <Truck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium text-lg">No shipments tracked yet</h3>
                    <p className="text-muted-foreground">
                      {shopProfile?.sitesLoggedIn?.includes("gmail") 
                        ? "Complete an order and we'll extract tracking info automatically"
                        : "Connect your Gmail to enable automatic tracking extraction"
                      }
                    </p>
                    {!shopProfile?.sitesLoggedIn?.includes("gmail") && (
                      <Button 
                        className="mt-4" 
                        variant="outline"
                        onClick={() => setActiveTab("accounts")}
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        Connect Gmail
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {tracking.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Truck className="h-4 w-4 text-primary" />
                              <span className="font-medium">{item.carrier || "Unknown Carrier"}</span>
                              <Badge variant={
                                item.status === "delivered" ? "default" :
                                item.status === "in_transit" ? "secondary" :
                                "outline"
                              }>
                                {item.status.replace("_", " ").toUpperCase()}
                              </Badge>
                            </div>
                            {item.tracking_number && (
                              <p className="text-sm font-mono">{item.tracking_number}</p>
                            )}
                            {item.last_update && (
                              <p className="text-sm text-muted-foreground">{item.last_update}</p>
                            )}
                            {item.estimated_delivery && (
                              <p className="text-sm text-green-600">
                                Est. delivery: {new Date(item.estimated_delivery).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                          {item.tracking_url && (
                            <Button size="sm" variant="outline" asChild>
                              <a href={item.tracking_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4 mr-1" />
                                Track
                              </a>
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Emails Tab */}
          <TabsContent value="emails">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-semibold">Order Emails</h2>
                  <p className="text-muted-foreground text-sm">
                    Emails related to your shopping orders from Gmail
                  </p>
                </div>
                <Button
                  onClick={syncOrderEmails}
                  disabled={isSyncingEmails || !shopProfile?.sitesLoggedIn?.includes("gmail")}
                >
                  {isSyncingEmails ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Sync Emails
                    </>
                  )}
                </Button>
              </div>

              {isSyncingEmails && (
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 flex items-center gap-3 text-sm text-blue-700 dark:text-blue-300">
                  <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
                  <div>
                    <p className="font-medium">Searching Gmail for order emails...</p>
                    <p className="text-xs opacity-80">This may take 2-3 minutes. The agent is browsing your inbox.</p>
                  </div>
                </div>
              )}

              {!shopProfile?.sitesLoggedIn?.includes("gmail") ? (
                <Card className="py-12">
                  <CardContent className="text-center">
                    <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium text-lg">Gmail Not Connected</h3>
                    <p className="text-muted-foreground mb-4">
                      Connect your Gmail to sync order-related emails
                    </p>
                    <Button variant="outline" onClick={() => setActiveTab("accounts")}>
                      <Mail className="h-4 w-4 mr-2" />
                      Connect Gmail
                    </Button>
                  </CardContent>
                </Card>
              ) : orderEmails.length === 0 ? (
                <Card className="py-12">
                  <CardContent className="text-center">
                    <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium text-lg">No order emails synced</h3>
                    <p className="text-muted-foreground mb-4">
                      Click "Sync Emails" to search Gmail for order confirmations, shipping updates, and more
                    </p>
                    <Button onClick={syncOrderEmails} disabled={isSyncingEmails}>
                      {isSyncingEmails ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="mr-2 h-4 w-4" />
                      )}
                      Sync Now
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {orderEmails.map((email) => (
                    <Card key={email.id} className={!email.is_read ? "border-l-4 border-l-primary" : ""}>
                      <CardContent className="pt-4 pb-4">
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={
                                email.email_type === "confirmation" ? "default" :
                                email.email_type === "shipping" ? "secondary" :
                                email.email_type === "tracking" ? "outline" :
                                "outline"
                              }>
                                {email.email_type}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {new Date(email.received_at).toLocaleDateString()}
                              </span>
                            </div>
                            <h4 className="font-medium text-sm truncate">{email.subject}</h4>
                            <p className="text-xs text-muted-foreground truncate">
                              From: {email.from_name || email.from_email}
                            </p>
                            {email.snippet && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {email.snippet}
                              </p>
                            )}
                            {email.extracted_data && Object.keys(email.extracted_data).length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {email.extracted_data.orderNumber && (
                                  <Badge variant="outline" className="text-xs">
                                    Order: {String(email.extracted_data.orderNumber)}
                                  </Badge>
                                )}
                                {email.extracted_data.trackingNumber && (
                                  <Badge variant="outline" className="text-xs">
                                    Tracking: {String(email.extracted_data.trackingNumber)}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                          {email.order_id && (
                            <Badge variant="secondary" className="flex-shrink-0">
                              Linked
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default AutoShop;
