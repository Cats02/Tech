package net.everbrightdigital.owner;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Map;

/** Owner-only Android client. Authentication and authorisation stay on the server. */
public class MainActivity extends Activity {
    private static final int BG=Color.rgb(4,8,20), PANEL=Color.rgb(9,21,42), TEXT=Color.rgb(244,248,255), MUTED=Color.rgb(185,202,225), ACCENT=Color.rgb(39,228,255);
    private static final int UNLOCK=81;
    private LinearLayout shell, bottom;
    private FrameLayout content;
    private WebView web;
    private ProgressBar progress;
    private TextView title;
    private LinearLayout error;
    private final Map<String,Button> tabs=new HashMap<>();
    private String lastUrl=NavigationPolicy.ORIGIN+"/admin";
    private boolean failed=false, unlocking=false, unlocked=false, destroyed=false;
    private long backgroundAt=0;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE,WindowManager.LayoutParams.FLAG_SECURE);
        WebView.setWebContentsDebuggingEnabled(false);
        if(state!=null && NavigationPolicy.trusted(state.getString("lastUrl"))) lastUrl=state.getString("lastUrl");
        createLayout();
        createWebView();
        web.loadUrl(lastUrl);
        if(android.os.Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
    }
    private int dp(float value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private TextView label(String value,int size,int color){TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(color);return view;}
    private GradientDrawable background(int color){GradientDrawable drawable=new GradientDrawable();drawable.setColor(color);drawable.setCornerRadius(dp(8));return drawable;}
    private Button button(String value,Runnable action){Button view=new Button(this);view.setText(value);view.setTextColor(TEXT);view.setTextSize(13);view.setAllCaps(false);view.setMinHeight(dp(48));view.setBackground(background(PANEL));view.setOnClickListener(v->action.run());return view;}
    private void createLayout(){
        shell=new LinearLayout(this);shell.setOrientation(LinearLayout.VERTICAL);shell.setBackgroundColor(BG);shell.setVisibility(View.INVISIBLE);
        shell.setOnApplyWindowInsetsListener((v,insets)->{
            if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets system=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());v.setPadding(system.left,system.top,system.right,system.bottom);}
            else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);header.setPadding(dp(16),dp(10),dp(10),dp(10));header.setBackgroundColor(PANEL);
        ImageView logo=new ImageView(this);logo.setImageResource(net.everbrightdigital.owner.R.drawable.owner_logo);logo.setScaleType(ImageView.ScaleType.FIT_CENTER);logo.setContentDescription("Everbright Digital");header.addView(logo,new LinearLayout.LayoutParams(dp(62),dp(48)));
        LinearLayout heading=new LinearLayout(this);heading.setOrientation(LinearLayout.VERTICAL);heading.setPadding(dp(12),0,dp(6),0);
        TextView brand=label("EVERBRIGHT OWNER",10,ACCENT);brand.setLetterSpacing(.1f);heading.addView(brand);title=label("Dashboard",18,TEXT);title.setTypeface(null,Typeface.BOLD);title.setSingleLine(true);title.setEllipsize(android.text.TextUtils.TruncateAt.END);heading.addView(title);header.addView(heading,new LinearLayout.LayoutParams(0,-2,1));
        Button refresh=button("Refresh",this::confirmRefresh);refresh.setContentDescription("Refresh current page");header.addView(refresh,new LinearLayout.LayoutParams(-2,dp(48)));shell.addView(header);
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));shell.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));
        content=new FrameLayout(this);shell.addView(content,new LinearLayout.LayoutParams(-1,0,1));
        bottom=new LinearLayout(this);bottom.setBackgroundColor(PANEL);bottom.setPadding(dp(4),dp(5),dp(4),dp(5));
        addTab("Home","/admin");addTab("Bookings","/admin/bookings");addTab("Calendar","/admin/calendar");addTab("Customers","/admin/customers");
        Button more=button("More",()->moreMenu());bottom.addView(more,new LinearLayout.LayoutParams(0,dp(58),1));tabs.put("More",more);shell.addView(bottom);
        setContentView(shell);
    }
    private void addTab(String name,String path){Button item=button(name,()->navigate(path));item.setTextSize(11);item.setPadding(dp(2),dp(4),dp(2),dp(4));item.setMinWidth(0);item.setMaxLines(2);bottom.addView(item,new LinearLayout.LayoutParams(0,dp(58),1));tabs.put(name,item);}
    private void createWebView(){
        web=new WebView(this);web.setBackgroundColor(BG);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSafeBrowsingEnabled(true);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);settings.setSaveFormData(false);settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString()+" EverbrightOwner/1.0");
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setDownloadListener((url,agent,disposition,mime,length)->Toast.makeText(this,"Open the website in your browser to download files.",Toast.LENGTH_LONG).show());
        web.setWebChromeClient(new WebChromeClient(){@Override public void onProgressChanged(WebView view,int value){progress.setProgress(value);progress.setVisibility(value==100?View.GONE:View.VISIBLE);}});
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString();
                if(NavigationPolicy.trusted(url))return false;
                if(request.isForMainFrame()&&request.hasGesture())openExternal(request.getUrl());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(NavigationPolicy.trusted(request.getUrl().toString()))return null;
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",null,new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){
                failed=false;
                if(!NavigationPolicy.trusted(url)){view.stopLoading();showError("This address cannot be opened in the owner app.");return;}
                hideError();
            }
            @Override public void onPageFinished(WebView view,String url){
                if(failed||!NavigationPolicy.trusted(url))return;
                if(Uri.parse(url).getPath().equals("/admin/login"))view.clearHistory();
                lastUrl=url;title.setText(NavigationPolicy.section(url));updateTabs();
                // Only styling on the trusted website; no JS bridge, credentials or tokens cross into Java.
                view.evaluateJavascript("(function(){if(!document.getElementById('owner-app-chrome')){var s=document.createElement('style');s.id='owner-app-chrome';s.textContent='.admin-workspace .site-header,.admin-workspace .admin-sidebar,.admin-login .site-header{display:none!important}.admin-workspace .admin-shell{display:block!important}.admin-workspace .admin-content{padding:22px 16px 40px!important}.admin-login .admin-content{padding:28px 18px!important}.admin-workspace .admin-page-heading .admin-eyebrow{display:none}.admin-workspace .admin-page-heading{margin-bottom:20px}';document.head.appendChild(s);}})();",null);
                CookieManager.getInstance().flush();
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError failure){if(request.isForMainFrame())showError("We couldn’t connect. Check your internet connection and try again.");}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame()&&response.getStatusCode()>=500)showError("The website is temporarily unavailable. Please try again shortly.");}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError failure){handler.cancel();showError("The secure connection could not be verified. Please try again later.");}
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){content.removeView(view);view.destroy();web=null;showError("The page needs to restart. Tap Try again.");return true;}
        });
        content.addView(web,new FrameLayout.LayoutParams(-1,-1));
    }
    private void updateTabs(){String section=NavigationPolicy.section(lastUrl);for(Map.Entry<String,Button> entry:tabs.entrySet()){boolean selected=entry.getKey().equals(section)||(entry.getKey().equals("Home")&&section.equals("Dashboard"))||(entry.getKey().equals("More")&&(section.equals("Availability")||section.equals("Email Notifications")||section.equals("Services & Pricing")));entry.getValue().setTextColor(selected?ACCENT:MUTED);entry.getValue().setSelected(selected);}}
    private void navigate(String path){hideError();if(web==null)createWebView();web.loadUrl(NavigationPolicy.ORIGIN+path);}
    private void hideError(){if(error!=null){content.removeView(error);error=null;}}
    private void showError(String message){failed=true;if(destroyed)return;hideError();error=new LinearLayout(this);error.setOrientation(LinearLayout.VERTICAL);error.setGravity(Gravity.CENTER);error.setPadding(dp(30),dp(30),dp(30),dp(30));error.setBackgroundColor(BG);TextView heading=label("Connection interrupted",23,TEXT);heading.setTypeface(null,Typeface.BOLD);error.addView(heading);TextView detail=label(message,16,MUTED);detail.setGravity(Gravity.CENTER);detail.setPadding(0,dp(16),0,dp(20));error.addView(detail);error.addView(button("Try again",()->{hideError();if(web==null)createWebView();web.loadUrl(lastUrl);}));content.addView(error,new FrameLayout.LayoutParams(-1,-1));progress.setVisibility(View.GONE);}
    private void confirmRefresh(){new AlertDialog.Builder(this).setTitle("Refresh this page?").setMessage("Any unsaved form details will be lost.").setPositiveButton("Refresh",(d,w)->{if(web!=null)web.reload();else navigate("/admin");}).setNegativeButton("Keep editing",null).show();}
    private void moreMenu(){PopupMenu menu=new PopupMenu(this,tabs.get("More"));String[] names={"Services & Pricing","Availability","Email Notifications","Open website in browser","Sign out"};for(String name:names)menu.getMenu().add(name);menu.setOnMenuItemClickListener(item->{String value=item.getTitle().toString();switch(value){case "Services & Pricing":navigate("/admin/services");break;case "Availability":navigate("/admin/settings");break;case "Email Notifications":navigate("/admin/emails");break;case "Open website in browser":openExternal(Uri.parse(NavigationPolicy.ORIGIN+"/admin"));break;case "Sign out":new AlertDialog.Builder(this).setTitle("Sign out?").setMessage("Your app session will end. Unsaved changes will be lost.").setPositiveButton("Sign out",(d,w)->{if(web!=null)web.evaluateJavascript("(function(){var f=document.querySelector('form[action=\"/admin/logout\"]');if(f){f.requestSubmit();}else{location.href='/admin/login';}})();",null);}).setNegativeButton("Cancel",null).show();break;}return true;});menu.show();}
    private void openExternal(Uri uri){String scheme=uri.getScheme();if(!"https".equalsIgnoreCase(scheme)&&!"mailto".equalsIgnoreCase(scheme)&&!"tel".equalsIgnoreCase(scheme))return;new AlertDialog.Builder(this).setTitle("Open another app?").setMessage("This link will open outside Everbright Owner.").setPositiveButton("Open",(d,w)->{try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException missing){Toast.makeText(this,"No app is available to open this link.",Toast.LENGTH_SHORT).show();}}).setNegativeButton("Cancel",null).show();}
    private void goBack(){if(web!=null&&web.canGoBack()){hideError();web.goBack();}else new AlertDialog.Builder(this).setTitle("Close Everbright Owner?").setMessage("Any unsaved changes will be lost.").setPositiveButton("Close",(d,w)->finish()).setNegativeButton("Stay",null).show();}
    // API 33+ uses the platform OnBackInvokedDispatcher registered in onCreate.
    // This override is retained only for physical/legacy Back on Android 8-12.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed(){goBack();}
    @Override protected void onResume(){super.onResume();if(!unlocked||(backgroundAt>0&&SystemClock.elapsedRealtime()-backgroundAt>30000)){KeyguardManager guard=(KeyguardManager)getSystemService(KEYGUARD_SERVICE);if(guard.isDeviceSecure()&&!unlocking){unlocking=true;shell.setVisibility(View.INVISIBLE);Intent intent=guard.createConfirmDeviceCredentialIntent("Everbright Owner","Unlock to access customer and booking information");if(intent!=null){startActivityForResult(intent,UNLOCK);return;}unlocking=false;}unlocked=true;}if(!unlocking)shell.setVisibility(View.VISIBLE);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==UNLOCK){unlocking=false;if(result==RESULT_OK){unlocked=true;backgroundAt=0;shell.setVisibility(View.VISIBLE);}else finish();}}
    @Override protected void onPause(){if(!unlocking){backgroundAt=SystemClock.elapsedRealtime();shell.setVisibility(View.INVISIBLE);}CookieManager.getInstance().flush();super.onPause();}
    @Override protected void onSaveInstanceState(Bundle state){state.putString("lastUrl",lastUrl);super.onSaveInstanceState(state);}
    @Override protected void onDestroy(){destroyed=true;if(web!=null){content.removeView(web);web.destroy();web=null;}super.onDestroy();}
}
