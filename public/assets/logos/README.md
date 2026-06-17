# SA Economy Survey Logos

Modern black-and-white logo system for the South African Economy Survey web app.

## Logo Versions

### 1. Icon-Only Logo (`icon-only.svg`)
- **Purpose**: Brand mark, social media avatars, app icons
- **Size**: 200x200px (scalable vector)
- **Features**: Abstract geometric shape combining South Africa outline with data visualization bars

### 2. Horizontal Logo (`logo-horizontal.svg`)
- **Purpose**: Web app header, README, social preview
- **Size**: 600x200px (scalable vector)
- **Features**: Icon + "SA Economy Survey" text + optional subtitle

### 3. Favicon (`favicon.svg`)
- **Purpose**: Browser favicon, small app icons
- **Size**: 100x100px (scalable vector)
- **Features**: Simplified, highly readable at 16x16px

## Design Philosophy

- **Color Scheme**: Black and white only (#000000 on transparent/white)
- **Style**: Minimal, modern, clean vector design
- **Typography**: System fonts for maximum compatibility
- **Geometry**: Sharp edges, clean lines, geometric shapes
- **Aesthetic**: Professional academic feel, suitable for data visualization

## Icon Concept

The logo combines:
- **Abstract South Africa outline**: Hexagonal/triangular fusion representing the nation
- **Data visualization bars**: Vertical lines of varying heights representing survey data
- **Survey data points**: Subtle dots representing individual responses
- **Baseline**: Horizontal line connecting all elements for stability

## Usage Guidelines

### Web App Header
```html
<img src="/assets/logos/logo-horizontal.svg" alt="SA Economy Survey" height="60">
```

### Favicon
```html
<link rel="icon" type="image/svg+xml" href="/assets/logos/favicon.svg">
```

### Social Media
Use `icon-only.svg` or `logo-horizontal.svg` depending on the platform's aspect ratio requirements.

## File Formats

All logos are provided in SVG format for:
- Infinite scalability without quality loss
- Small file sizes
- Easy editing and customization
- Perfect rendering at any resolution

## Color Variants

The logos are designed in black (#000000) on transparent background. For white backgrounds, use as-is. For dark backgrounds, invert the colors:

```css
.invert-on-dark {
  filter: invert(1);
}
```