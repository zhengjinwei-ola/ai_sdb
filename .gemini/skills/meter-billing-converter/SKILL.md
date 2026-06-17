---
name: meter-billing-converter
description: Automates water and electricity meter billing calculation and PDF generation. Supports generating PDFs directly from an Excel sheet or by transcribing handwritten meter-reading images first, aligning them into a standard Excel format (using an existing sheet or local assets/meter_billing_template.xlsx as a styling template), and then compiling them into final PDF notices.
---

# Meter Billing Converter

This skill automates the calculation of water and electricity usage fees from an Excel template or from handwritten meter-reading images, and generates a professionally formatted, paginated PDF invoice notice using LibreOffice's headless Writer conversion.

## Two Supported Workflows

This skill supports two main generation pipelines:

1. **Direct Excel-to-PDF Pipeline** (when you already have the structured Excel sheet).
2. **Handwritten Image-to-Excel-to-PDF Pipeline** (when you have handwritten images of meter readings and want to extract, validate, and convert them).

---

## Workflow 1: Direct Excel-to-PDF Pipeline

If you already have a formatted Excel sheet with the current and previous readings (e.g. `水电表26年6月抄表.xlsx` or `template.xlsx`):

```bash
python3 <path-to-skill>/scripts/generate_billing_pdf.py <excel_file> [output_pdf]
```

*Note: If `output_pdf` is not specified, the script automatically parses the year and month from the Excel filename (e.g. `水电表26年6月抄表.xlsx` -> `2026年6月抄表计费通知单.pdf`).*

---

## Workflow 2: Handwritten Image-to-Excel-to-PDF Pipeline

Use this pipeline when you have handwritten images of meter readings (e.g. `1.jpg`, `2.jpg`, `3.jpg`) and want to generate the billing Excel and PDF.

### Step-by-Step Procedure:

1. **Examine the Images**:
   - Use the `read_file` tool to inspect each handwritten image file.
   - Look for the month columns (e.g., Column `5` for May, Column `6` for June) to identify the target previous and current readings.

2. **Locate the Styling Template**:
   - Look for an existing Excel file in the workspace (e.g., `template.xlsx`, `水电表26年6月抄表.xlsx`) to use as a format and style template.
   - If no template exists in the workspace, use the skill's bundled fallback template at `<path-to-skill>/assets/meter_billing_template.xlsx`.

3. **Map and Transcribe the Readings**:
   - Match the handwritten shop code (e.g., `1-2#`, `3#`) to the corresponding row in the template.
   - **CRITICAL: Always use the exact shop names from the template. Do NOT recognize or update shop names from the handwriting on the images; only extract the numeric meter readings.**
   - For each meter (e.g., `电表 1`, `电表 2`, `电表 3`, `水表`), map the previous month's reading to "上期读数" and the current month's reading to "本期读数".
   - Keep unit rates, labor fees, and rubbish fees consistent with the template.

4. **Programmatically Populate the Excel File**:
   - Write a lightweight Python script using `openpyxl` to open the template workbook, populate the transcribed values (with appropriate `None` values for unused meters), and save as a new Excel file (e.g. `水电表26年7月抄表.xlsx`).
   - Run the script in the workspace virtual environment.

5. **Generate the PDF Notices**:
   - Run the `generate_billing_pdf.py` script on the newly generated Excel file:
     ```bash
     python3 <path-to-skill>/scripts/generate_billing_pdf.py <new_excel_file>
     ```

---

## Key Capabilities

1. **Automatic Parsing**: Reads columns A to N in the spreadsheet, supporting up to 3 separate electricity meters (`电表 1`, `电表 2`, `电表 3`) and 1 water meter per shop.
2. **Deterministic Rounding**: Electricity and water consumption fees are calculated using standard human-rounding (`int(val + 0.5)`) instead of banker's rounding.
3. **RMB Uppercase Translation**: Converts float invoice totals into standard Chinese financial uppercase characters (e.g. `1723.00` -> `壹仟柒佰贰拾叁元整`).
4. **Stable A4 Pagination**: Renders HTML with strict CSS `page-break-before: always;` and wraps notices in containers to guarantee exactly 3 notices per A4 page and place the Summary Table on its own separate final page.

## System Dependencies

This skill requires the following system tools and libraries to be available:
- **Python 3.13+** with `openpyxl` installed
- **LibreOffice** (`soffice`) installed under `/opt/homebrew/bin/soffice` (macOS default location)
