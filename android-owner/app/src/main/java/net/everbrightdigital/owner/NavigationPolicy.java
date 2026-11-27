package net.everbrightdigital.owner;

import java.net.URI;

public final class NavigationPolicy {
    public static final String ORIGIN = "https://everbrightdigital.net";
    private NavigationPolicy() {}
    public static boolean trusted(String value) {
        if (value == null) return false;
        try {
            URI uri = new URI(value);
            return "https".equalsIgnoreCase(uri.getScheme())
                && "everbrightdigital.net".equalsIgnoreCase(uri.getHost())
                && uri.getRawUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception invalid) { return false; }
    }
    public static String section(String value) {
        if (!trusted(value)) return "Home";
        String path = URI.create(value).getPath();
        if (path.startsWith("/admin/bookings")) return "Bookings";
        if (path.startsWith("/admin/calendar")) return "Calendar";
        if (path.startsWith("/admin/customers")) return "Customers";
        if (path.startsWith("/admin/services")) return "Services & Pricing";
        if (path.startsWith("/admin/settings")) return "Availability";
        if (path.startsWith("/admin/emails")) return "Email Notifications";
        if (path.equals("/admin/login")) return "Owner sign in";
        return "Dashboard";
    }
}
