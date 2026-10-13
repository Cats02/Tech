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
