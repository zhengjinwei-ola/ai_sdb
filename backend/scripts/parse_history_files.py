import os
import re
import sys
import json
import openpyxl

def parse_period(filename):
    # Regex to capture year (25 or 26) and month (1 to 12)
    m = re.search(r'水电表\s*(\d+)\s*年\s*(\d+)\s*月', filename)
    if m:
        year = int(m.group(1))
        month = int(m.group(2))
        return f"20{year:02d}-{month:02d}"
    return None

def is_valid_reading(val):
    if val is None:
        return False
    if str(val).strip() == "":
        return False
    return True

def is_valid_reading_aux(val):
    if val is None:
        return False
    val_str = str(val).strip()
    if val_str == "" or val_str == "0" or val_str == "0.0" or val_str == "0.00":
        return False
    return True

def parse_excel_file(filepath):
    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    headers = rows[0]
    data_rows = rows[1:]
    
    result = []
    for r in data_rows:
        if not r or r[0] is None:
            continue
        shop_code = str(r[0]).strip()
        shop_name = str(r[1]).strip()
        
        # Extract readings and rates
        e1_prev = r[2]
        e1_curr = r[3]
        w_prev = r[4]
        w_curr = r[5]
        e2_prev = r[6]
        e2_curr = r[7]
        e3_prev = r[8]
        e3_curr = r[9]
        
        w_price = float(r[10]) if r[10] is not None else 4.13
        e_price = float(r[11]) if r[11] is not None else 1.03
        labor_fee = float(r[12]) if r[12] is not None else 0.0
        rubbish_fee = float(r[13]) if r[13] is not None else 0.0
        
        result.append({
            "shop_code": shop_code,
            "shop_name": shop_name,
            "labor_fee": labor_fee,
            "rubbish_fee": rubbish_fee,
            "water_price": w_price,
            "electricity_price": e_price,
            "meters": [
                {
                    "type": "electricity",
                    "name": "电表1",
                    "unit_price": e_price,
                    "previous": e1_prev,
                    "current": e1_curr
                },
                {
                    "type": "water",
                    "name": "水表",
                    "unit_price": w_price,
                    "previous": w_prev,
                    "current": w_curr
                },
                {
                    "type": "electricity",
                    "name": "电表2",
                    "unit_price": e_price,
                    "previous": e2_prev,
                    "current": e2_curr
                } if is_valid_reading_aux(e2_prev) or is_valid_reading_aux(e2_curr) else None,
                {
                    "type": "electricity",
                    "name": "电表3",
                    "unit_price": e_price,
                    "previous": e3_prev,
                    "current": e3_curr
                } if is_valid_reading_aux(e3_prev) or is_valid_reading_aux(e3_curr) else None,
            ]
        })
    return result

def main():
    root_dir = '/Users/oswin/study/ai_sdb'
    files = os.listdir(root_dir)
    
    parsed_data = {}
    for f in files:
        if f.endswith('.xlsx') and '水电表' in f:
            period = parse_period(f)
            if period:
                filepath = os.path.join(root_dir, f)
                try:
                    parsed_data[period] = parse_excel_file(filepath)
                except Exception as ex:
                    print(f"Error parsing file {f}: {str(ex)}", file=sys.stderr)
                    
    print(json.dumps(parsed_data, ensure_ascii=False))

if __name__ == '__main__':
    main()
