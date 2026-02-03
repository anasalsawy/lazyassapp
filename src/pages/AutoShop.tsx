import { useState, useRef } from "react";
import { useAutoShop } from "@/hooks/useAutoShop";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, MapPin, ShoppingCart, Plus, Trash2, Loader2, Package, CheckCircle, XCircle, Search, Image, Link as LinkIcon, X, Briefcase } from "lucide-react";

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
  } = useAutoShop();

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

  const [orderForm, setOrderForm] = useState({
    product_query: "",
    product_image: null as File | null,
    product_image_preview: "",
    reference_url: "",
    max_price: "",
    quantity: "1",
    shipping_address_id: "",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);

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
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-foreground">🛒 Auto-Shop</h1>
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
          <TabsList className="mb-6">
            <TabsTrigger value="shop" className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Shop
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

          {/* Cards Tab - Owner Only */}
          {isOwner && (
          <TabsContent value="cards">
            <div className="space-y-4">
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
                          <Button variant="ghost" size="icon" onClick={() => deleteCard(card.id)}>
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
              <h2 className="text-xl font-semibold">Order History</h2>

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
                    <Card key={order.id}>
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
        </Tabs>
      </div>
    </div>
  );
};

export default AutoShop;
