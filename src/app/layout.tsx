import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { NativeAuthListener } from "@/components/features/auth/native-auth-listener";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

// Plus Jakarta Sans (OFL), variable weight 200–800, self-hosted so no runtime request leaves the app.
const jakarta = localFont({
  variable: "--font-jakarta",
  display: "swap",
  src: [
    { path: "../fonts/plus-jakarta-sans-latin.woff2", weight: "200 800", style: "normal" },
    { path: "../fonts/plus-jakarta-sans-latin-ext.woff2", weight: "200 800", style: "normal" },
    { path: "../fonts/plus-jakarta-sans-vietnamese.woff2", weight: "200 800", style: "normal" },
    { path: "../fonts/plus-jakarta-sans-cyrillic-ext.woff2", weight: "200 800", style: "normal" },
  ],
});

const DESCRIPTION = "Meet someone closer to home. Dating for the Maldives. Private by design, 18+ only.";

export const metadata: Metadata = {
  title: { default: "Mellocrush", template: "%s · Mellocrush" },
  description: DESCRIPTION,
  applicationName: "Mellocrush",
  openGraph: { title: "Mellocrush", siteName: "Mellocrush", description: DESCRIPTION, type: "website" },
  twitter: { card: "summary", title: "Mellocrush", description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFBF1",
};

/*
 * Two things that must be settled before the first paint.
 *
 * THEME: applies the stored appearance so there is no flash. Per-viewer convenience only.
 *
 * NATIVE: marks the document when it is being rendered inside the Android shell's WebView, which the stylesheet
 * uses to drop `backdrop-filter` (docs/ARCHITECTURE.md §28). NOTE: the reasoning that introduced that rule — a
 * renderer killed by stacked blurs — was DISPROVEN by on-device telemetry, which showed no renderer death of any
 * kind. The rule is harmless and stays only until the real fault is fixed, at which point it should go.
 */
const themeInit = `(function(){try{var t=localStorage.getItem('thundi.theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute('content','#000000');}}}catch(e){}try{if(navigator.userAgent.indexOf('MelloCrushAndroid')!==-1){document.documentElement.setAttribute('data-native','android');}}catch(e){}})();`;

/*
 * TEMPORARY. Finds out what is navigating the Android shell in a loop, and comes out again the moment it has.
 *
 * On-device telemetry established what the fault is NOT: no renderer crash, no network, HTTP or SSL error, no
 * uncaught exception, no hang. The WebView loads https://www.mellocrush.com/, paints, and is then sent to
 * `https://www.mellocrush.com/?` roughly once a second, for ever. The trailing `?` says a URL was built through
 * a URL or searchParams API and serialised with an empty query, which means JavaScript did it. This records
 * which JavaScript, with a stack.
 *
 * It lives here rather than in the app because an inline script in <head> runs before Next's own bundles, so a
 * navigation issued during startup cannot happen before the probe is watching — and because a page-side probe
 * needs no new APK and no reinstall.
 *
 * Inert off the shell: the first line returns for every browser, so the website is untouched. Reports go to
 * /__diag/js/… paths that do not exist; the point is the request line in the server log. Capped per page load
 * so a loop cannot turn into a flood.
 */
const nativeNavigationProbe = `(function(){try{
if(navigator.userAgent.indexOf('MelloCrushAndroid')===-1)return;
var sent=0,MAX=24;
function send(tag,text){try{
if(sent>=MAX)return;
text=String(text).slice(0,900);
var b=btoa(unescape(encodeURIComponent(text))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
var n=Math.ceil(b.length/148)||1;
for(var i=0;i<n&&sent<MAX;i++){sent++;
var u='/__diag/js/'+tag+'/'+i+'of'+n+'/'+b.substr(i*148,148);
if(navigator.sendBeacon){navigator.sendBeacon(u);}else{(new Image()).src=u;}}
}catch(e){}}
function stack(){try{throw new Error('probe');}catch(e){return (e.stack||'nostack').replace(/\\n/g,' | ');}}
try{var n0=performance.getEntriesByType('navigation')[0];
send('nav',(n0?n0.type:'unknown')+' href='+location.href+' ref='+(document.referrer||'none'));}catch(e){}
function leaving(ev){send('leave',ev.type+' :: '+stack());}
addEventListener('beforeunload',leaving,true);
addEventListener('pagehide',leaving,true);
['pushState','replaceState'].forEach(function(m){var o=history[m];history[m]=function(){
send('hist',m+' -> '+arguments[2]+' :: '+stack());return o.apply(history,arguments);};});
try{['assign','replace','reload'].forEach(function(m){var o=location[m].bind(location);
Object.defineProperty(location,m,{configurable:true,value:function(){
send('loc',m+'('+arguments[0]+') :: '+stack());return o.apply(null,arguments);}});});
}catch(e){send('loc','override-failed '+e);}
addEventListener('error',function(e){send('err',(e.message||'')+' @ '+(e.filename||'')+':'+(e.lineno||''));},true);
addEventListener('unhandledrejection',function(e){send('rej',String((e.reason&&e.reason.stack)||e.reason));});
}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <script dangerouslySetInnerHTML={{ __html: nativeNavigationProbe }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
        {/* Inert on the website: one user-agent test in an effect. Inside the Android shell it is what hears the
            browser come back from Google or Telegram, wherever the user happens to be (ARCHITECTURE §4.1c). */}
        <NativeAuthListener />
      </body>
    </html>
  );
}
