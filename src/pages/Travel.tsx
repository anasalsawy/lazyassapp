import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plane, ArrowRight, Loader2, Users, Calendar, MapPin, Luggage, CheckCircle2, X } from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";

type Slice = { origin: string; destination: string; departure_date: string };
type PaxType = "adult" | "child" | "infant_without_seat";

function fmtDuration(iso?: string) {
  if (!iso) return "";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return iso;
  return `${m[1] ?? 0}h ${m[2] ?? 0}m`;
}
function fmtTime(s?: string) {
  if (!s) return "";
  return new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(s?: string) {
  if (!s) return "";
  return new Date(s).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export default function Travel() {
  const [tripType, setTripType] = useState<"one_way" | "round_trip" | "multi_city">("round_trip");
  const [cabin, setCabin] = useState("economy");
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [slices, setSlices] = useState<Slice[]>([
    { origin: "", destination: "", departure_date: "" },
    { origin: "", destination: "", departure_date: "" },
  ]);

  const [loading, setLoading] = useState(false);
  const [offers, setOffers] = useState<any[]>([]);
  const [currency, setCurrency] = useState<string>("USD");
  const [selectedOffer, setSelectedOffer] = useState<any | null>(null);
  const [offerDetail, setOfferDetail] = useState<any | null>(null);
  const [loadingOffer, setLoadingOffer] = useState(false);

  const updateSlice = (idx: number, patch: Partial<Slice>) =>
    setSlices((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const search = async () => {
    const active = tripType === "one_way" ? slices.slice(0, 1) : tripType === "round_trip" ? slices.slice(0, 2) : slices;
    // round-trip: set return slice origin/dest from first
    if (tripType === "round_trip") {
      active[1] = { ...active[1], origin: slices[0].destination, destination: slices[0].origin };
    }
    if (active.some((s) => !s.origin || !s.destination || !s.departure_date)) {
      toast.error("Fill all origin, destination and dates");
      return;
    }
    const passengers: { type: PaxType }[] = [
      ...Array(adults).fill({ type: "adult" as PaxType }),
      ...Array(children).fill({ type: "child" as PaxType }),
      ...Array(infants).fill({ type: "infant_without_seat" as PaxType }),
    ];
    setLoading(true);
    setOffers([]);
    try {
      const { data, error } = await supabase.functions.invoke("duffel-search", {
        body: { slices: active, passengers, cabin_class: cabin },
      });
      if (error) throw error;
      setOffers(data.offers ?? []);
      setCurrency(data.currency ?? "USD");
      if ((data.offers ?? []).length === 0) toast.info("No offers returned for that route");
    } catch (e: any) {
      toast.error(e.message ?? "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const openOffer = async (offer: any) => {
    setSelectedOffer(offer);
    setOfferDetail(null);
    setLoadingOffer(true);
    try {
      const { data, error } = await supabase.functions.invoke("duffel-offer", {
        body: { offer_id: offer.id, include_services: true },
      });
      if (error) throw error;
      setOfferDetail(data.offer);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load offer");
    } finally {
      setLoadingOffer(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Plane className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Travel</h1>
              <p className="text-muted-foreground text-sm">Search & book flights with Duffel — live inventory from 300+ airlines.</p>
            </div>
          </div>
        </header>

        {/* Search panel */}
        <Card className="p-6 space-y-4 border-2 shadow-lg">
          <Tabs value={tripType} onValueChange={(v) => setTripType(v as any)}>
            <TabsList>
              <TabsTrigger value="round_trip">Round trip</TabsTrigger>
              <TabsTrigger value="one_way">One way</TabsTrigger>
              <TabsTrigger value="multi_city">Multi-city</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3">
              <Label>From (IATA)</Label>
              <Input placeholder="IAH" value={slices[0].origin} onChange={(e) => updateSlice(0, { origin: e.target.value.toUpperCase() })} maxLength={3} />
            </div>
            <div className="md:col-span-3">
              <Label>To (IATA)</Label>
              <Input placeholder="CAI" value={slices[0].destination} onChange={(e) => updateSlice(0, { destination: e.target.value.toUpperCase() })} maxLength={3} />
            </div>
            <div className="md:col-span-2">
              <Label>Depart</Label>
              <Input type="date" value={slices[0].departure_date} onChange={(e) => updateSlice(0, { departure_date: e.target.value })} />
            </div>
            {tripType === "round_trip" && (
              <div className="md:col-span-2">
                <Label>Return</Label>
                <Input type="date" value={slices[1].departure_date} onChange={(e) => updateSlice(1, { departure_date: e.target.value })} />
              </div>
            )}
            <div className="md:col-span-2">
              <Label>Cabin</Label>
              <Select value={cabin} onValueChange={setCabin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="economy">Economy</SelectItem>
                  <SelectItem value="premium_economy">Premium Economy</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="first">First</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {tripType === "multi_city" && (
            <div className="space-y-2 border-t pt-4">
              {slices.slice(1).map((s, i) => (
                <div key={i + 1} className="grid md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-3"><Label>From</Label><Input value={s.origin} onChange={(e) => updateSlice(i+1, { origin: e.target.value.toUpperCase() })} maxLength={3} /></div>
                  <div className="md:col-span-3"><Label>To</Label><Input value={s.destination} onChange={(e) => updateSlice(i+1, { destination: e.target.value.toUpperCase() })} maxLength={3} /></div>
                  <div className="md:col-span-2"><Label>Depart</Label><Input type="date" value={s.departure_date} onChange={(e) => updateSlice(i+1, { departure_date: e.target.value })} /></div>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setSlices([...slices, { origin: "", destination: "", departure_date: "" }])}>+ Add flight</Button>
            </div>
          )}

          <div className="grid md:grid-cols-4 gap-3">
            <div><Label>Adults</Label><Input type="number" min={1} max={9} value={adults} onChange={(e) => setAdults(+e.target.value)} /></div>
            <div><Label>Children (2–11)</Label><Input type="number" min={0} max={8} value={children} onChange={(e) => setChildren(+e.target.value)} /></div>
            <div><Label>Infants (&lt;2)</Label><Input type="number" min={0} max={adults} value={infants} onChange={(e) => setInfants(+e.target.value)} /></div>
            <div className="flex items-end">
              <Button onClick={search} disabled={loading} className="w-full" size="lg">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Search flights</>}
              </Button>
            </div>
          </div>
        </Card>

        {/* Results */}
        {loading && (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
            Searching live inventory…
          </div>
        )}

        {!loading && offers.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{offers.length} offers</h2>
              <Badge variant="secondary">Sorted by price</Badge>
            </div>
            {offers.map((o) => (
              <OfferRow key={o.id} offer={o} onSelect={() => openOffer(o)} />
            ))}
          </div>
        )}

        <OfferDialog
          offer={offerDetail}
          baseOffer={selectedOffer}
          loading={loadingOffer}
          open={!!selectedOffer}
          onClose={() => { setSelectedOffer(null); setOfferDetail(null); }}
          paxCount={{ adults, children, infants }}
        />
      </div>
    </AppLayout>
  );
}

function OfferRow({ offer, onSelect }: { offer: any; onSelect: () => void }) {
  return (
    <Card className="p-5 hover:border-primary/50 transition cursor-pointer" onClick={onSelect}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 space-y-3">
          {offer.slices.map((s: any, idx: number) => {
            const first = s.segments[0];
            const last = s.segments[s.segments.length - 1];
            const stops = s.segments.length - 1;
            return (
              <div key={idx} className="flex items-center gap-4">
                <img src={first.marketing_carrier.logo_symbol_url} alt={first.marketing_carrier.name} className="w-10 h-10 rounded bg-muted object-contain" />
                <div className="flex-1 grid grid-cols-5 items-center gap-2">
                  <div>
                    <div className="font-semibold text-lg">{fmtTime(first.departing_at)}</div>
                    <div className="text-xs text-muted-foreground">{first.origin.iata_code}</div>
                  </div>
                  <div className="col-span-3 text-center">
                    <div className="text-xs text-muted-foreground">{fmtDuration(s.duration)}</div>
                    <div className="relative h-px bg-border my-1">
                      <ArrowRight className="w-3 h-3 absolute right-0 -top-1.5 text-muted-foreground" />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {stops === 0 ? "Nonstop" : `${stops} stop${stops > 1 ? "s" : ""}`} · {first.marketing_carrier.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-lg">{fmtTime(last.arriving_at)}</div>
                    <div className="text-xs text-muted-foreground">{last.destination.iata_code}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-right pl-4 border-l">
          <div className="text-2xl font-bold">{offer.total_currency} {parseFloat(offer.total_amount).toFixed(2)}</div>
          <div className="text-xs text-muted-foreground mb-3">total</div>
          <Button size="sm">Select</Button>
        </div>
      </div>
    </Card>
  );
}

function OfferDialog({ offer, baseOffer, loading, open, onClose, paxCount }: any) {
  const o = offer ?? baseOffer;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plane className="w-5 h-5" /> Review & book</DialogTitle>
        </DialogHeader>
        {loading || !o ? (
          <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : (
          <BookingFlow offer={o} paxCount={paxCount} onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BookingFlow({ offer, paxCount, onDone }: any) {
  const [step, setStep] = useState<"review" | "passengers" | "extras" | "pay" | "done">("review");
  const passengerSlots = offer.passengers ?? [];
  const [pax, setPax] = useState(() => passengerSlots.map((p: any) => ({
    id: p.id,
    type: p.type,
    title: "mr",
    given_name: "",
    family_name: "",
    born_on: "",
    gender: "m",
    email: "",
    phone_number: "",
  })));
  const [services, setServices] = useState<{ id: string; quantity: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  const toggleService = (id: string) => {
    setServices((prev) => prev.find((s) => s.id === id) ? prev.filter((s) => s.id !== id) : [...prev, { id, quantity: 1 }]);
  };

  const extrasTotal = (offer.available_services ?? [])
    .filter((s: any) => services.find((x) => x.id === s.id))
    .reduce((sum: number, s: any) => sum + parseFloat(s.total_amount), 0);

  const total = parseFloat(offer.total_amount) + extrasTotal;

  const book = async () => {
    if (pax.some((p: any) => !p.given_name || !p.family_name || !p.born_on)) {
      toast.error("Fill all passenger details");
      return;
    }
    if (!pax[0].email || !pax[0].phone_number) {
      toast.error("Email and phone required on lead passenger");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("duffel-create-order", {
        body: { offer_id: offer.id, passengers: pax, services },
      });
      if (error) throw error;
      setResult(data.order);
      setStep("done");
      toast.success(`Booked! Ref ${data.order.booking_reference}`);
    } catch (e: any) {
      toast.error(e.message ?? "Booking failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "done" && result) {
    return (
      <div className="text-center py-8 space-y-3">
        <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
        <h3 className="text-xl font-semibold">Booking confirmed</h3>
        <div className="text-3xl font-bold tracking-wider">{result.booking_reference}</div>
        <p className="text-sm text-muted-foreground">{result.total_currency} {result.total_amount} charged via Duffel</p>
        <Button onClick={onDone}>Done</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Itinerary summary */}
      <Card className="p-4 bg-muted/30">
        {offer.slices.map((s: any, i: number) => (
          <div key={i} className="text-sm space-y-1 mb-3 last:mb-0">
            <div className="font-medium flex items-center gap-2"><MapPin className="w-3 h-3" /> {s.origin.iata_code} → {s.destination.iata_code} · {fmtDate(s.segments[0].departing_at)}</div>
            {s.segments.map((seg: any, j: number) => (
              <div key={j} className="text-xs text-muted-foreground pl-5">
                {seg.marketing_carrier.iata_code}{seg.marketing_carrier_flight_number} · {fmtTime(seg.departing_at)} {seg.origin.iata_code} → {fmtTime(seg.arriving_at)} {seg.destination.iata_code} · {fmtDuration(seg.duration)}
              </div>
            ))}
          </div>
        ))}
      </Card>

      {/* Passengers */}
      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Users className="w-4 h-4" /> Passengers</h3>
        <div className="space-y-4">
          {pax.map((p: any, idx: number) => (
            <Card key={p.id} className="p-4 space-y-3">
              <div className="text-xs text-muted-foreground uppercase">Passenger {idx + 1} · {p.type}</div>
              <div className="grid md:grid-cols-4 gap-3">
                <div><Label>Title</Label>
                  <Select value={p.title} onValueChange={(v) => setPax((prev: any) => prev.map((x: any, i: number) => i === idx ? { ...x, title: v } : x))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mr">Mr</SelectItem>
                      <SelectItem value="ms">Ms</SelectItem>
                      <SelectItem value="mrs">Mrs</SelectItem>
                      <SelectItem value="miss">Miss</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Given name</Label><Input value={p.given_name} onChange={(e) => setPax((prev: any) => prev.map((x: any, i: number) => i === idx ? { ...x, given_name: e.target.value } : x))} /></div>
                <div><Label>Family name</Label><Input value={p.family_name} onChange={(e) => setPax((prev: any) => prev.map((x: any, i: number) => i === idx ? { ...x, family_name: e.target.value } : x))} /></div>
                <div><Label>Date of birth</Label><Input type="date" value={p.born_on} onChange={(e) => setPax((prev: any) => prev.map((x: any, i: number) => i === idx ? { ...x, born_on: e.target.value } : x))} /></div>
                <div><Label>Gender</Label>
                  <Select value={p.gender} onValueChange={(v) => setPax((prev: any) => prev.map((x: any, i: number) => i === idx ? { ...x, gender: v } : x))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="m">Male</SelectItem>
                      <SelectItem value="f">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {idx === 0 && (
                  <>
                    <div className="md:col-span-2"><Label>Email</Label><Input type="email" value={p.email} onChange={(e) => setPax((prev: any) => prev.map((x: any, i: number) => i === idx ? { ...x, email: e.target.value } : x))} /></div>
                    <div><Label>Phone (E.164)</Label><Input placeholder="+15555551234" value={p.phone_number} onChange={(e) => setPax((prev: any) => prev.map((x: any, i: number) => i === idx ? { ...x, phone_number: e.target.value } : x))} /></div>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Extras */}
      {offer.available_services?.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Luggage className="w-4 h-4" /> Add extras</h3>
          <div className="grid md:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
            {offer.available_services.map((s: any) => {
              const selected = !!services.find((x) => x.id === s.id);
              const label = s.type === "baggage"
                ? `${s.metadata?.type ?? "Bag"} · ${s.metadata?.maximum_weight_kg ?? "?"}kg`
                : s.type;
              return (
                <button key={s.id} type="button" onClick={() => toggleService(s.id)}
                  className={`text-left p-3 rounded-lg border-2 transition ${selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{label}</span>
                    <span>{s.total_currency} {s.total_amount}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Pay */}
      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Total due now</div>
            <div className="text-3xl font-bold">{offer.total_currency} {total.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground mt-1">Paid via Duffel balance</div>
          </div>
          <Button size="lg" onClick={book} disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm & book"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
