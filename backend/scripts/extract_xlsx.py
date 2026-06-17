import openpyxl
import json
import sys
import os

def main():
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        workspace_root = os.path.abspath(os.path.join(script_dir, '../..'))
        template_path = os.path.join(workspace_root, 'meter-billing-converter/assets/meter_billing_template.xlsx')
        wb = openpyxl.load_workbook(template_path)
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
                    } if e2_prev is not None or e2_curr is not None else None,
                    {
                        "type": "electricity",
                        "name": "电表3",
                        "unit_price": e_price,
                        "previous": e3_prev,
                        "current": e3_curr
                    } if e3_prev is not None or e3_curr is not None else None,
                ]
            })
            
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
