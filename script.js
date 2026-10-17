// Shared accessibility controls: include this script and style.css on every page.
(() => {
    const key = "everbright-accessibility";
    const modes = ["default", "protanopia", "deuteranopia", "tritanopia", "high-contrast"];
    const textSizes = [90, 100, 110, 120, 130, 140];
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let settings = { colour: "default", motion: null, textSize: 100 };
    function read() {
        try {
            const saved = JSON.parse(localStorage.getItem(key));
            settings = {
                colour: modes.includes(saved?.colour) ? saved.colour : "default",
                motion: typeof saved?.motion === "boolean" ? saved.motion : null,
                textSize: textSizes.includes(saved?.textSize) ? saved.textSize : 100
            };
        } catch { settings = { colour: "default", motion: null, textSize: 100 }; }
    }
    read();
    const widget = document.createElement("div");
    widget.className = "accessibility-widget";
    widget.innerHTML = `
        <button type="button" class="accessibility-launcher" aria-label="Accessibility Settings"
            title="Accessibility Settings" aria-expanded="false" aria-controls="accessibility-panel">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="6.5" r="1.3" fill="currentColor" stroke="none"/>
                <path d="M5.5 10 12 11l6.5-1M12 11v4m0 0-3 4m3-4 3 4" stroke-linecap="round"/>
            </svg>
        </button>
        <section id="accessibility-panel" class="accessibility-panel" aria-labelledby="accessibility-title" hidden>
            <div class="accessibility-heading"><h2 id="accessibility-title">Accessibility Settings</h2>
                <button type="button" class="accessibility-close" aria-label="Close Accessibility Settings">×</button></div>
            <fieldset class="accessibility-text-size"><legend>Text Size</legend>
                <div class="accessibility-size-controls">
                    <button type="button" data-text-size="decrease" aria-label="Decrease website text size">A−</button>
                    <button type="button" data-text-size="default" aria-label="Restore default website text size (100%)">A</button>
                    <button type="button" data-text-size="increase" aria-label="Increase website text size">A+</button>
                    <output id="accessibility-size-value" aria-live="polite" aria-atomic="true" aria-label="Website text size">100%</output>
                </div>
            </fieldset>
            <label for="accessibility-colour">Colour Vision</label>
            <select id="accessibility-colour">
                <option value="default">Default</option><option value="protanopia">Protanopia</option>
                <option value="deuteranopia">Deuteranopia</option><option value="tritanopia">Tritanopia</option>
                <option value="high-contrast">High Contrast</option>
            </select>
            <fieldset><legend>Motion</legend><label class="accessibility-motion" for="accessibility-motion">
                <input type="checkbox" role="switch" id="accessibility-motion" aria-describedby="accessibility-motion-note"> Reduce Motion
            </label><p id="accessibility-motion-note">Follows your device setting until changed. Reset restores this.</p></fieldset>
            <button type="button" class="accessibility-reset">Reset Settings</button>
        </section>`;
    document.body.append(widget);
    const launcher = widget.querySelector(".accessibility-launcher");
    const panel = widget.querySelector(".accessibility-panel");
    const colour = widget.querySelector("select");
    const motion = widget.querySelector("input");
    const decrease = widget.querySelector('[data-text-size="decrease"]');
    const increase = widget.querySelector('[data-text-size="increase"]');
    function apply() {
        document.documentElement.style.fontSize = `${settings.textSize}%`;
        document.documentElement.dataset.textSize = String(settings.textSize);
        widget.querySelector("output").textContent = `${settings.textSize}%`;
        decrease.setAttribute("aria-disabled", String(settings.textSize === textSizes[0]));
        increase.setAttribute("aria-disabled", String(settings.textSize === textSizes[textSizes.length - 1]));
        document.documentElement.dataset.colourVision = settings.colour;
        const reduced = settings.motion ?? preference.matches;
        document.documentElement.dataset.reduceMotion = String(reduced);
        colour.value = settings.colour;
        motion.checked = reduced;
    }
    function save() {
        try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Settings still work when storage is unavailable. */ }
        apply();
    }
    function close(restoreFocus = false) {
        panel.hidden = true;
        launcher.setAttribute("aria-expanded", "false");
        if (restoreFocus) launcher.focus();
    }
    launcher.addEventListener("click", () => {
        if (!panel.hidden) return close(true);
        panel.hidden = false;
        launcher.setAttribute("aria-expanded", "true");
        decrease.focus();
    });
    widget.querySelector(".accessibility-close").addEventListener("click", () => close(true));
    colour.addEventListener("change", () => { settings.colour = colour.value; save(); });
    motion.addEventListener("change", () => { settings.motion = motion.checked; save(); });
    widget.querySelectorAll("[data-text-size]").forEach(button => {
        button.addEventListener("click", () => {
            const action = button.dataset.textSize;
            const index = textSizes.indexOf(settings.textSize);
            settings.textSize = action === "default" ? 100 :
                textSizes[Math.max(0, Math.min(textSizes.length - 1, index + (action === "increase" ? 1 : -1)))];
            save();
        });
    });
    widget.querySelector(".accessibility-reset").addEventListener("click", () => {
        settings = { colour: "default", motion: null, textSize: 100 };
        save();
    });
    document.addEventListener("pointerdown", event => {
        if (!panel.hidden && !widget.contains(event.target)) close(panel.contains(document.activeElement));
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) { event.preventDefault(); close(true); }
    });
    widget.addEventListener("focusout", event => {
        if (!widget.contains(event.relatedTarget)) close();
    });
    preference.addEventListener("change", apply);
    window.addEventListener("storage", event => { if (event.key === key || event.key === null) { read(); apply(); } });
    apply();
})();

// =====================================
// Mobile Navigation Menu
// =====================================

const menuButton = document.getElementById("menuButton");
const navLinks = document.getElementById("navLinks");

if (menuButton && navLinks) {
    menuButton.addEventListener("click", () => {
        const menuIsOpen = navLinks.classList.toggle("active");

        menuButton.setAttribute("aria-expanded", menuIsOpen);

        menuButton.textContent = menuIsOpen ? "✕" : "☰";

        menuButton.setAttribute(
            "aria-label",
            menuIsOpen
                ? "Close navigation menu"
                : "Open navigation menu"
        );
    });

// =====================================
// Close Mobile Menu When Link Clicked
// =====================================

    const navigationLinks = navLinks.querySelectorAll("a");

    navigationLinks.forEach((link) => {
        link.addEventListener("click", () => {
            navLinks.classList.remove("active");

            menuButton.setAttribute("aria-expanded", "false");

            menuButton.textContent = "☰";

            menuButton.setAttribute(
                "aria-label",
                "Open navigation menu"
            );
        });
    });
}

// =====================================
// Highlight the Current Homepage Section
// =====================================

const homepageSections = document.querySelectorAll("main section[id]");
const homepageNavLinks = document.querySelectorAll(
    '.nav-links a[href^="#"]'
);

if (homepageSections.length && homepageNavLinks.length) {
    const sectionObserver = new IntersectionObserver(
        (entries) => {
            const visibleSection = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

            if (!visibleSection) {
                return;
            }

            homepageNavLinks.forEach((link) => {
                const isCurrent =
                    link.getAttribute("href") ===
                    `#${visibleSection.target.id}`;

                if (isCurrent) {
                    link.setAttribute("aria-current", "location");
                } else {
                    link.removeAttribute("aria-current");
                }
            });
        },
        {
            rootMargin: "-25% 0px -60% 0px",
            threshold: [0, 0.15, 0.35]
        }
    );

    homepageSections.forEach((section) => sectionObserver.observe(section));
}

// =====================================
// Display Current Year in Footer
// =====================================

const currentYear = document.getElementById("currentYear");

if (currentYear) {
    currentYear.textContent = new Date().getFullYear();
}

// =====================================
// Send Enquiries Through Formspree
// =====================================

const contactForm = document.getElementById("contactForm");
const formMessage = document.getElementById("formMessage");
const submitButton = document.getElementById("submitButton");

if (contactForm && formMessage && submitButton) {
    contactForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        formMessage.className = "form-message";
        formMessage.textContent = "Sending your enquiry...";
        submitButton.disabled = true;
        submitButton.textContent = "Sending...";

        try {
            const response = await fetch(contactForm.action, {
                method: contactForm.method,
                body: new FormData(contactForm),
                headers: {
                    Accept: "application/json"
                }
            });

            if (!response.ok) {
                throw new Error("Form submission failed");
            }

            contactForm.reset();
            formMessage.classList.add("success");
            formMessage.textContent =
                "Thank you. Your enquiry has been sent successfully.";
        } catch (error) {
            formMessage.classList.add("error");
            formMessage.textContent =
                "Sorry, your enquiry could not be sent. Please try again.";
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Send Enquiry";
        }
    });
}
