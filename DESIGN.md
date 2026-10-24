---
name: Book Collection
description: A handheld collection utility with a desktop shelf.
colors:
  "primary": "#3156c8"
  "primary-hover": "#2445ad"
  "on-primary": "#fff"
  "ink": "#232936"
  "muted": "#626c7b"
  "paper": "#f7f8fa"
  "white": "#ffffff"
  "line": "#dce1e8"
  "soft": "#edf1fa"
  "button-hover": "#edf0f5"
  "focus": "#6683d7"
  "selection": "#dbe5ff"
  "placeholder": "#687385"
  "line-hover": "#aeb9ca"
  "surface-inset": "#f0f2f6"
  "tab-active": "#e7edfc"
  "status-background": "#eef0f4"
  "success-background": "#e8f0e4"
  "success-ink": "#46613c"
  "warning-background": "#fbf0da"
  "warning-ink": "#8e6b2d"
  "red": "#b33838"
  "error-background": "#fff2ef"
  "error-line": "#e9c5c0"
  "error-ink": "#8c3930"
  "backdrop": "#111a2d80"
  "toast-background": "#232936"
  "toast-ink": "#fff"
  "primary-dark": "#a9bfff"
  "primary-hover-dark": "#c1d0ff"
  "on-primary-dark": "#15234b"
  "ink-dark": "#e5e9f0"
  "muted-dark": "#aab3c2"
  "paper-dark": "#181b22"
  "white-dark": "#222630"
  "line-dark": "#3b4250"
  "soft-dark": "#2c3549"
  "button-hover-dark": "#303747"
  "focus-dark": "#a9bfff"
  "selection-dark": "#394b73"
  "placeholder-dark": "#a6afbf"
  "line-hover-dark": "#73819a"
  "surface-inset-dark": "#272d38"
  "tab-active-dark": "#303e60"
  "status-background-dark": "#333b48"
  "success-background-dark": "#2c402b"
  "success-ink-dark": "#b4d1a6"
  "warning-background-dark": "#433720"
  "warning-ink-dark": "#e4c382"
  "red-dark": "#f19b93"
  "error-background-dark": "#422b28"
  "error-line-dark": "#79504a"
  "error-ink-dark": "#f3b1a7"
  "backdrop-dark": "#050a14b3"
  "toast-background-dark": "#34476e"
  "toast-ink-dark": "#e5e9f0"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif'
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  headline-handheld:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif'
    fontSize: "27px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif'
    fontSize: "24px"
    fontWeight: 650
    letterSpacing: "-0.025em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  field:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  shelf-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  stat:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif'
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "0"
rounded:
  "cover": "3px"
  "navigation": "7px"
  "ui": "8px"
  "dialog": "12px"
  "status": "20px"
spacing:
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "14": "14px"
  "16": "16px"
  "18": "18px"
  "20": "20px"
  "24": "24px"
  "28": "28px"
  "32": "32px"
  "36": "36px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.ui}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ui}"
    padding: "10px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.button-hover}"
  button-danger:
    backgroundColor: "{colors.white}"
    textColor: "{colors.red}"
    rounded: "{rounded.ui}"
    padding: "10px 16px"
  button-text:
    textColor: "{colors.muted}"
    rounded: "{rounded.ui}"
    padding: "10px"
  field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ui}"
    padding: "11px 13px"
    typography: "{typography.field}"
  navigation-active:
    backgroundColor: "{colors.tab-active}"
    textColor: "{colors.primary}"
    rounded: "{rounded.navigation}"
    padding: "11px 14px"
  status:
    backgroundColor: "{colors.status-background}"
    rounded: "{rounded.status}"
    padding: "4px 9px"
  status-read:
    backgroundColor: "{colors.success-background}"
    textColor: "{colors.success-ink}"
    rounded: "{rounded.status}"
    padding: "4px 9px"
  status-reading:
    backgroundColor: "{colors.warning-background}"
    textColor: "{colors.warning-ink}"
    rounded: "{rounded.status}"
    padding: "4px 9px"
  shelf-cover:
    rounded: "{rounded.cover}"
  entry-dialog:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
  entry-dialog-handheld:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "0"
    width: "100%"
---

# Design System: Book Collection

## Overview

**Creative North Star: "The Handheld Collection Utility"**

The handheld collection utility is quiet, precise and book-led. Cool neutral surfaces, graphite text and restrained cobalt actions support capture and browsing; actual covers supply the visual variety.

The interface uses native UI typography, compact corners and divided summaries. Handheld controls stay within reach; desktop space expands the shelf rather than enlarging decorative chrome.

**Key Characteristics:**

- Cool neutral surfaces and cobalt actions.
- Compact UI typography with readable catalog metadata.
- Flat summaries, real cover imagery and restrained component borders.
- Handheld capture controls and a desktop navigation rail.

Ground truth: `app/styles/theme.css`, the final `app/styles/interface.css` overrides, and the shared layout/forms/chrome/shelf styles; sampled components are CollectionShell, CollectionHeader, CollectionTabs, NavigationPosition, DiscoveryPanel and ShelfEntries. Desktop and handheld entry screenshots corroborate the resulting hierarchy. This is an extracted system after the finish review, not a pre-build seed.

## Colors

### Primary

Cobalt (`primary`) marks Add/Save, links and the active destination. Its darker hover partner is `primary-hover`; `on-primary` supplies the button text. The legacy CSS variable `--green` now carries the same cobalt value as `--primary`.

### Neutral

Cool paper (`paper`) is the page field; `white` is the control, header and dialog surface. Graphite (`ink`), muted slate (`muted`), dividers (`line`) and inset surfaces (`surface-inset`) create hierarchy. Active navigation uses `tab-active`. Hover, focus, selection and placeholder values are explicit tokens, not opacity variants of body text.

Reading state uses the existing neutral, success and warning token families. Destructive and error states use `red` and the error family; they are semantic exceptions to the single action accent.

Frontmatter keys ending in `-dark` are exact values from `:root[data-theme="dark"]` for the corresponding unsuffixed CSS variable. They are theme replacements, not extra accents. The live component snippets bind to the unsuffixed CSS variables so theme changes propagate. Sidecar tonal ramps are synthesized swatch previews, not additional shipped palette steps.

**The Action Accent Rule.** Use cobalt for actions, links, focus and the current destination; let book covers carry the broader color range.

## Typography

**UI Font:** The system stack in the frontmatter, including Tahoma for mixed Thai and Latin content. There is no separate display face.

Page headings use the headline roles. Collection headings tighten tracking to the recorded value; other headings inherit (-0.025em). Series headings use (28px) on desktop and (24px) handheld. Dialog headings use the title role and reduce to (22px) handheld. Shelf captions use the shelf-title role, rising to (14px) handheld, while metadata uses caption. Compact summary numbers use stat, reducing to (14px) handheld; summary labels reduce from (13px) to (12px). Form controls retain field sizing, including handheld search, to keep entry readable. Desktop shelf search is (15px).

**The Utility Type Rule.** Use the shared UI stack for headings, metadata and entry controls. Keep page titles compact and labels in sentence case.

## Layout

The final stylesheet is loaded last. Preserve its responsive shell rather than inheriting superseded ornamental layouts from earlier stylesheets.

- Desktop above (1000px): header maximum width (1600px), minimum height (72px), padding (12px 32px). The fixed navigation rail is (198px) wide at top (104px), with a minimum left inset (20px). Content starts after a (238px) reserved rail, has maximum width (1328px) and padding (32px 36px).
- Compact desktop (761–1000px): rail width (170px), left inset (16px), content left margin (194px), padding (28px 24px). The backup link becomes icon-only.
- Handheld at (760px) and below: header minimum height (64px), padding (10px 16px); navigation becomes a sticky, horizontally scrollable strip at top (64px). NavigationPosition scrolls the current destination into view. Main padding is (24px 16px), with bottom clearance `calc(100px + env(safe-area-inset-bottom))` and no rail margin.
- Shelf desktop: auto-fill columns with minimum width (138px), gap (26px 20px). At (760px) and below use two equal columns, gap (24px 16px); from (560px) through (760px) use three equal columns. Covers retain aspect ratio (264 / 370). Caption text clamps to two lines; placeholder titles clamp to five.
- Handheld capture: two equal bottom actions, gap (10px), minimum height (50px), a top divider and safe-area padding. Handheld search spans the toolbar, with two filters and a (44px) refresh control below. Discover filters stack into one column; release filters retain two columns and release/discovery results become one column.
- Entry: desktop dialogs cap at (650px) width. At (760px) and below Book Entry fills the viewport and uses `--book-dialog-top` / `--book-dialog-height` to follow available viewport height. Header/footer remain separate from the scrolling body. At (560px) and below the title and purchase subforms stack; the ISBN input spans the row above its two actions. Save is in the persistent footer.

The recorded spacing steps are observed values, not an enforced mathematical scale. Closely related controls use (6–12px); content groups use (16–24px); desktop page spacing uses (28–36px).

## Elevation & Depth

Most surfaces are flat: inline stats and discovery/release rows use dividers rather than raised containers. Buttons have no resting shadow. Covers retain a small physical edge (`1px 3px 8px #14203814`). Dialogs and toasts use the theme shadow (`0 24px 80px #17243b26` light; `0 24px 80px #0008` dark). Backdrops use the corresponding theme token without blur.

Shared interaction transitions last (160ms) with `ease`. Button press moves down (1px); shelf hover does not move the card. Dialog entry animates opacity and (8px) vertical travel over (160ms ease-out). Reduced motion reduces animation/transition duration to (0.01ms) and restores automatic scrolling.

**The Flat Summary Rule.** Collection counts sit inline above a divider. Reserve elevation for overlays and the physical edge of a cover.

## Shapes

Use the recorded UI radius for controls, utility containers and toasts, the navigation radius for destinations, and the dialog radius for desktop overlays. Book Entry becomes square-edged handheld. Cover edges use the small cover radius; captions and shelf items have no surrounding card surface. Reading-status badges retain their compact pill shape. Borders and row dividers are (1px); empty states use a dashed border.

## Components

### Buttons

Primary actions are cobalt; secondary actions use the control surface and a divider border. Both use padding (10px 16px), weight (600), minimum height (44px) and the UI radius. Handheld capture and Save increase to (50px). Primary hover uses its explicit token; secondary hover uses button-hover. Danger uses red text and the danger border/hover tokens. Text actions use muted text, a soft hover surface and cobalt hover text. Disabled buttons use opacity (0.5), a disabled cursor and no press translation.

Keyboard focus is a (3px) solid focus outline offset by (3px); disclosure summaries use (4px) offset. Preserve the independent focus state rather than relying on hover color.

### Inputs / Fields

Inputs use the field role, padding (11px 13px), a (1px) line border, white surface and UI radius. Shared form fields are at least (48px) high; labels and hints remain separate from placeholder text. Search reserves (42px) left padding for its icon. Hover strengthens the border to line-hover; focus changes the border to cobalt and retains the visible focus outline. Native selection and validation remain available. Nonempty form errors use error-background/error-line, UI radius and padding (12px 14px); error banners use the error ink.

### Navigation

Destinations are compact icon/text rows with minimum height (44px). Resting text is muted; hover uses cobalt text and button-hover; the active destination uses tab-active, cobalt text and weight (650). Active state is exposed with `aria-current="page"`. Keep the active destination visible in the handheld scrolling strip. The rail becomes a strip through layout, not smaller touch targets.

### Status / Shelf / Summaries

Reading badges use a small leading dot, font (11px), padding (4px 9px), and semantic neutral/read/reading colors. Shelf entries expose the cover, two-line title and compact metadata, with no surrounding raised card. Real covers load lazily; missing covers use an inset surface, divider border, book icon and title without generated decorative imagery. Hover changes the caption to cobalt; keyboard focus outlines the whole shelf item with (5px) offset.

Collection counts are baseline-aligned value/label pairs above a divider, with no icons, progress bars or individual card fills. Spending stays in a disclosure. Release and discovery records use flat bottom-divided rows, compact book metadata and touch-sized actions.

### Entry / Feedback

Book Entry retains ISBN lookup/scan, required-field labels, optional metadata, validation and a persistent Save footer; handheld fields use readable (16px) text. The secondary Check action shares the bottom capture bar. General dialogs retain compact rounded edges handheld; full-height square entry is specific to Book Entry. Toasts use the contrasting theme surface and sit above the capture bar at `calc(86px + env(safe-area-inset-bottom))` handheld; desktop offset is (24px).

## Do's and Don'ts

### Do:

- **Do** use the shared UI font and theme variables for reusable surfaces.
- **Do** preserve the 44px primary control minimum and the 48–50px handheld entry controls.
- **Do** keep capture actions and entry Save reachable above the safe area and virtual keyboard.
- **Do** preserve visible keyboard focus, current navigation visibility and readable selected filter text.
- **Do** use real collection covers; show a plain title placeholder when a cover is unavailable.

### Don't:

- **Don't** add ornamental header illustrations, oversized metric cards or decorative labels.
- **Don't** add display type or decorative serif treatments to utility controls.
- **Don't** introduce hover lift to shelf cards; the shipped hover changes the caption color.
- **Don't** allow handheld content to run behind the fixed capture bar or create horizontal document overflow.

Not canonized or repaired: no unresolved fix-list defects were reported by the completed review. Legacy source selectors and overridden decorative values are implementation history, not guidance for new surfaces. No shipping raster assets were authored for this system.
