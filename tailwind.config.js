/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Apple macOS dark mode system palette
                background: "#000000",           // Pure black — macOS dark base
                foreground: "#ffffff",            // White
                primary: "#0a84ff",              // Apple System Blue (dark mode)
                secondary: "#1c1c1e",            // Apple systemGray6
                surface: "#2c2c2e",              // Apple systemGray5
                "surface-elevated": "#3a3a3c",   // Apple systemGray4
                // Apple system semantic colors (dark mode)
                "apple-red": "#ff453a",
                "apple-green": "#32d74b",
                "apple-yellow": "#ffd60a",
                "apple-cyan": "#64d2ff",
                "apple-purple": "#bf5af2",
                "apple-orange": "#ff9f0a",
                "apple-pink": "#ff375f",
            },
            borderRadius: {
                // Apple uses larger, softer radii
                "apple-sm": "8px",
                "apple-md": "12px",
                "apple-lg": "16px",
                "apple-xl": "20px",
                "apple-2xl": "24px",
            },
            keyframes: {
                slideIn: {
                    '0%': { opacity: '0', transform: 'translateX(100%) scale(0.95)' },
                    '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
                },
            },
            animation: {
                slideIn: 'slideIn 0.2s ease-out',
            },
        },
    },
    plugins: [],
}
