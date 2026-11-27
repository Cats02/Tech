package net.everbrightdigital.owner;
import org.junit.Test;
import static org.junit.Assert.*;
public class NavigationPolicyTest {
    @Test public void onlyExactHttpsOriginIsTrusted() {
        assertTrue(NavigationPolicy.trusted("https://everbrightdigital.net/admin"));
        assertTrue(NavigationPolicy.trusted("https://everbrightdigital.net:443/admin?date=2026-11-28"));
        for (String url : new String[]{null,"http://everbrightdigital.net/admin","https://everbrightdigital.net.evil.test/","https://evil.test@everbrightdigital.net/","https://everbrightdigital.net:444/","file:///etc/passwd","javascript:alert(1)","intent://admin","https://www.everbrightdigital.net/admin","https://everbrightdigital.net\\@evil.test/"}) assertFalse(String.valueOf(url),NavigationPolicy.trusted(url));
    }
    @Test public void nativeNavigationTracksPrivateSections() {
        assertEquals("Bookings",NavigationPolicy.section("https://everbrightdigital.net/admin/bookings/4"));
        assertEquals("Calendar",NavigationPolicy.section("https://everbrightdigital.net/admin/calendar?view=month"));
        assertEquals("Owner sign in",NavigationPolicy.section("https://everbrightdigital.net/admin/login"));
    }
}
