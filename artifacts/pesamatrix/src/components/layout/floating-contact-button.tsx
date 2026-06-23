import { useState, useRef, useEffect } from "react";
import { Phone, Mail, MessageCircle, X, HeadphonesIcon } from "lucide-react";
import { useGetCustomerCareSettings, getGetCustomerCareSettingsQueryKey } from "@workspace/api-client-react";

function cleanPhone(phone: string): string {
  return phone.replace(/\s+/g, "");
}
function waNumber(phone: string): string {
  return cleanPhone(phone).replace(/^\+/, "");
}

export function FloatingContactButton() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: settings } = useGetCustomerCareSettings({
    query: { queryKey: getGetCustomerCareSettingsQueryKey(), staleTime: 5 * 60 * 1000 },
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!settings) return null;

  const hasContent = settings.phone1 || settings.phone2 || settings.whatsapp || settings.email;
  if (!hasContent) return null;

  return (
    <div ref={containerRef} className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="mb-1 w-64 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <span className="text-sm font-semibold text-foreground">Contact Support</span>
            <button
              onClick={() => setOpen(false)}
              className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {settings.supportHours && (
            <div className="px-4 py-2 border-b border-border/50">
              <p className="text-xs text-muted-foreground">{settings.supportHours}</p>
            </div>
          )}

          <div className="p-2 space-y-1">
            {settings.phone1 && (
              <a
                href={`tel:${cleanPhone(settings.phone1)}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-blue-600/10 hover:text-blue-400 transition-colors group"
              >
                <div className="h-8 w-8 rounded-lg bg-blue-600/10 flex items-center justify-center shrink-0 group-hover:bg-blue-600/20 transition-colors">
                  <Phone className="h-4 w-4 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground leading-tight">Call us</p>
                  <p className="text-sm font-medium text-foreground truncate">{settings.phone1}</p>
                </div>
              </a>
            )}
            {settings.phone2 && (
              <a
                href={`tel:${cleanPhone(settings.phone2)}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-blue-600/10 hover:text-blue-400 transition-colors group"
              >
                <div className="h-8 w-8 rounded-lg bg-blue-600/10 flex items-center justify-center shrink-0 group-hover:bg-blue-600/20 transition-colors">
                  <Phone className="h-4 w-4 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground leading-tight">Call us</p>
                  <p className="text-sm font-medium text-foreground truncate">{settings.phone2}</p>
                </div>
              </a>
            )}
            {settings.whatsapp && (
              <a
                href={`https://wa.me/${waNumber(settings.whatsapp)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-green-600/10 hover:text-green-400 transition-colors group"
              >
                <div className="h-8 w-8 rounded-lg bg-green-600/10 flex items-center justify-center shrink-0 group-hover:bg-green-600/20 transition-colors">
                  <MessageCircle className="h-4 w-4 text-green-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground leading-tight">WhatsApp</p>
                  <p className="text-sm font-medium text-foreground truncate">{settings.whatsapp}</p>
                </div>
              </a>
            )}
            {settings.email && (
              <a
                href={`mailto:${settings.email}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-blue-600/10 hover:text-blue-400 transition-colors group"
              >
                <div className="h-8 w-8 rounded-lg bg-blue-600/10 flex items-center justify-center shrink-0 group-hover:bg-blue-600/20 transition-colors">
                  <Mail className="h-4 w-4 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground leading-tight">Email us</p>
                  <p className="text-sm font-medium text-foreground truncate">{settings.email}</p>
                </div>
              </a>
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className={`h-12 w-12 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          open
            ? "bg-muted border border-border text-muted-foreground hover:bg-muted/80"
            : "bg-green-600 hover:bg-green-700 text-white hover:scale-105"
        }`}
        title="Contact Support"
      >
        {open ? <X className="h-5 w-5" /> : <HeadphonesIcon className="h-5 w-5" />}
      </button>
    </div>
  );
}
