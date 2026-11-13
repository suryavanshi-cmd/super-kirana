#!/usr/bin/env python3
"""Builds public/catalog/v1.json: a ready-made list of common Maharashtra kirana products.

Prices are APPROXIMATE suggested retail prices (₹) for guidance only; the shop owner confirms or
changes every price before a product is added to the shop. Run: python3 scripts/build-catalog.py
"""
import json, re, os

def sz(code):
    """'500g' -> ('500 g', '500 ग्रॅम')"""
    m = re.fullmatch(r'(\d+(?:\.\d+)?)(kg|g|L|ml|pc|pk)', code)
    n, u = m.groups()
    en = {'kg': 'kg', 'g': 'g', 'L': 'L', 'ml': 'ml', 'pc': 'pcs', 'pk': 'pack'}[u]
    mr = {'kg': 'किलो', 'g': 'ग्रॅम', 'L': 'लिटर', 'ml': 'मिली', 'pc': 'नग', 'pk': 'पॅक'}[u]
    return f'{n} {en}', f'{n} {mr}'

ITEMS = []   # (ref, name_mr, name_en, category, unit, price_paise, brand)
SEEN = set()

def slug(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s[:40].strip('-')

def add(brand_en, brand_mr, item_en, item_mr, cat, sizes, unit='packet'):
    """sizes: list of (code, price_rupees)"""
    for code, price in sizes:
        se, sm = sz(code)
        en = ' '.join(x for x in [brand_en, item_en, se] if x)
        mr = ' '.join(x for x in [brand_mr, item_mr, sm] if x)
        ref = slug(en)
        if ref in SEEN:
            continue
        SEEN.add(ref)
        ITEMS.append([ref, mr, en, cat, unit, int(round(price * 100)), brand_en or ''])

def loose(item_en, item_mr, cat, price, unit='kg'):
    """Sold loose (सुटे), priced per kg / litre."""
    ref = slug('loose ' + item_en)
    if ref in SEEN:
        return
    SEEN.add(ref)
    ITEMS.append([ref, f'{item_mr} (सुटे)', f'{item_en} (loose)', cat, unit, int(round(price * 100)), ''])

# ------------------------------------------------------------------ categories
GR, RI, DAL, OIL, SUG, MAS, TEA, BIS, SNK, CHO, MLK, BEV, NDL, SAU, DRY, WASH, CLEAN, SOAP, HAIR, TEETH, POOJA, HEALTH, BABY, OTHER = (
    'धान्य व पीठ', 'तांदूळ', 'डाळी व कडधान्ये', 'तेल व तूप', 'साखर, गूळ व मीठ', 'मसाले', 'चहा व कॉफी', 'बिस्किटे',
    'नमकीन व स्नॅक्स', 'चॉकलेट व गोळ्या', 'दूध व दुग्धजन्य', 'पेये', 'नूडल्स व झटपट', 'सॉस, लोणचे व पापड', 'सुका मेवा',
    'कपडे धुणे', 'भांडी व घर स्वच्छता', 'आंघोळीचे साबण', 'केस व त्वचा', 'दात', 'पूजा साहित्य', 'आरोग्य', 'बाळ', 'इतर')

# ------------------------------------------------------------------ loose staples (per kg / litre)
for en, mr, p in [
    ('Sugar', 'साखर', 46), ('Wheat', 'गहू', 34), ('Wheat Sharbati', 'गहू शरबती', 48), ('Jowar', 'ज्वारी', 45), ('Bajra', 'बाजरी', 32),
    ('Nachni (Ragi)', 'नाचणी', 50), ('Maize', 'मका', 30), ('Wheat Flour (Atta)', 'गव्हाचे पीठ', 40), ('Jowar Flour', 'ज्वारीचे पीठ', 55),
    ('Bajra Flour', 'बाजरीचे पीठ', 40), ('Rice Flour', 'तांदळाचे पीठ', 50), ('Besan', 'बेसन', 95), ('Maida', 'मैदा', 42), ('Rava (Sooji)', 'रवा', 45),
    ('Poha Thick', 'जाड पोहे', 55), ('Poha Thin', 'पातळ पोहे', 58), ('Sabudana', 'साबुदाणा', 85), ('Murmure', 'चुरमुरे', 70), ('Daliya', 'दलिया', 50),
    ('Jaggery', 'गूळ', 55), ('Jaggery Kolhapuri', 'कोल्हापुरी गूळ', 70), ('Salt Crystal', 'खडे मीठ', 20), ('Rock Salt (Sendha)', 'सैंधव मीठ', 60),
    ]:
    loose(en, mr, SUG if en.startswith(('Sugar', 'Jaggery', 'Salt', 'Rock')) else GR, p)
for en, mr, p in [
    ('Rice Kolam', 'कोलम तांदूळ', 58), ('Rice Indrayani', 'इंद्रायणी तांदूळ', 62), ('Rice Ambemohar', 'आंबेमोहोर तांदूळ', 95),
    ('Rice Basmati', 'बासमती तांदूळ', 110), ('Rice Basmati Tukda', 'बासमती तुकडा', 70), ('Rice Sona Masoori', 'सोना मसुरी तांदूळ', 60),
    ('Rice HMT', 'एचएमटी तांदूळ', 55), ('Rice Surti Kolam', 'सुरती कोलम तांदूळ', 52), ('Rice Ration (Ukda)', 'उकडा तांदूळ', 40),
    ('Rice Jeera Sali', 'जिरा साळ तांदूळ', 75), ('Rice Wada Kolam', 'वाडा कोलम तांदूळ', 80)]:
    loose(en, mr, RI, p)
for en, mr, p in [
    ('Toor Dal', 'तूर डाळ', 150), ('Moong Dal', 'मूग डाळ', 120), ('Moong Dal Chilka', 'मूग डाळ सालीची', 115), ('Masoor Dal', 'मसूर डाळ', 95),
    ('Masoor Whole', 'अख्खा मसूर', 90), ('Urad Dal', 'उडीद डाळ', 130), ('Urad Whole', 'अख्खे उडीद', 120), ('Chana Dal', 'हरभरा डाळ', 90),
    ('Kabuli Chana', 'काबुली चणे', 140), ('Kala Chana', 'काळे चणे (हरभरा)', 85), ('Moong Whole', 'अख्खे मूग', 115), ('Matki', 'मटकी', 120),
    ('Chavali', 'चवळी', 100), ('Rajma', 'राजमा', 150), ('Hulga (Kulith)', 'कुळीथ (हुलगे)', 110), ('Green Peas Dry', 'सुके वाटाणे', 90),
    ('White Peas', 'पांढरे वाटाणे', 80), ('Val', 'वाल', 160), ('Peanuts (Shengdane)', 'शेंगदाणे', 130), ('Peanuts Roasted', 'भाजलेले शेंगदाणे', 160),
    ('Dalia (Futane)', 'फुटाणे', 120), ('Soybean', 'सोयाबीन', 60)]:
    loose(en, mr, DAL, p)
for en, mr, p in [
    ('Groundnut Oil', 'शेंगदाणा तेल', 190), ('Soybean Oil', 'सोयाबीन तेल', 140), ('Sunflower Oil', 'सूर्यफूल तेल', 150),
    ('Cottonseed Oil', 'सरकी तेल', 140), ('Palm Oil', 'पाम तेल', 115), ('Mustard Oil', 'मोहरी तेल', 175), ('Safflower Oil (Kardai)', 'करडई तेल', 260),
    ('Coconut Oil', 'खोबरेल तेल', 300), ('Til Oil', 'तीळ तेल', 320)]:
    loose(en, mr, OIL, p, 'litre')
loose('Ghee', 'तूप', OIL, 650)
for en, mr, p in [
    ('Turmeric Powder', 'हळद पावडर', 220), ('Red Chilli Powder', 'लाल तिखट', 280), ('Kashmiri Chilli Powder', 'काश्मिरी मिरची पावडर', 450),
    ('Coriander Powder', 'धणे पावडर', 200), ('Cumin (Jeera)', 'जिरे', 400), ('Mustard Seeds (Mohari)', 'मोहरी', 120), ('Coriander Seeds', 'धणे', 160),
    ('Fenugreek (Methi)', 'मेथी दाणे', 120), ('Fennel (Badishep)', 'बडीशेप', 260), ('Ajwain (Ova)', 'ओवा', 280), ('Sesame (Til)', 'तीळ', 200),
    ('Dry Red Chilli Byadgi', 'ब्याडगी मिरची', 400), ('Dry Red Chilli Guntur', 'गुंटूर मिरची', 260), ('Black Pepper', 'काळी मिरी', 900),
    ('Cloves (Lavang)', 'लवंग', 1200), ('Cinnamon (Dalchini)', 'दालचिनी', 500), ('Cardamom (Velchi)', 'वेलची', 3000), ('Bay Leaf (Tamalpatra)', 'तमालपत्र', 150),
    ('Star Anise (Badiyan)', 'बादियान', 900), ('Dry Coconut (Khobra)', 'सुके खोबरे', 260), ('Desiccated Coconut', 'खोबरे कीस', 300),
    ('Tamarind (Chinch)', 'चिंच', 160), ('Kokum', 'कोकम', 300), ('Hing Loose', 'हिंग', 3000), ('Khaskhas (Poppy)', 'खसखस', 1600),
    ('Kalonji', 'कलौंजी', 300), ('Nagkeshar', 'नागकेशर', 2000), ('Dagad Phool', 'दगडफूल', 1200), ('Garam Masala Loose', 'गरम मसाला', 600),
    ('Goda Masala Loose', 'गोडा मसाला', 500), ('Kanda Lasun Masala Loose', 'कांदा लसूण मसाला', 450), ('Malvani Masala Loose', 'मालवणी मसाला', 500)]:
    loose(en, mr, MAS, p)
for en, mr, p in [
    ('Almonds', 'बदाम', 900), ('Cashew', 'काजू', 1000), ('Raisins (Manuka)', 'मनुका', 400), ('Kishmish', 'किसमिस', 450), ('Dates (Khajur)', 'खजूर', 250),
    ('Pista', 'पिस्ता', 1800), ('Walnut', 'अक्रोड', 1400), ('Anjeer', 'अंजीर', 1300), ('Charoli', 'चारोळी', 2400), ('Makhana', 'मखाना', 1200),
    ('Khadi Sakhar', 'खडीसाखर', 100), ('Dry Ginger (Sunth)', 'सुंठ', 500)]:
    loose(en, mr, DRY, p)
loose('Tea Loose', 'चहा पावडर', TEA, 400)
loose('Kerosene', 'रॉकेल', OTHER, 90, 'litre')
for en, mr, p in [('Onion', 'कांदा', 30), ('Potato', 'बटाटा', 30), ('Garlic', 'लसूण', 200), ('Ginger', 'आले', 120)]:
    loose(en, mr, OTHER, p)

# ------------------------------------------------------------------ packaged: grains & flours
add('Aashirvaad', 'आशीर्वाद', 'Shudh Chakki Atta', 'शुद्ध चक्की आटा', GR, [('1kg', 62), ('5kg', 290), ('10kg', 560)])
add('Aashirvaad', 'आशीर्वाद', 'Multigrain Atta', 'मल्टीग्रेन आटा', GR, [('1kg', 80), ('5kg', 370)])
add('Aashirvaad', 'आशीर्वाद', 'Select Sharbati Atta', 'सिलेक्ट शरबती आटा', GR, [('5kg', 360)])
add('Pillsbury', 'पिल्सबरी', 'Chakki Fresh Atta', 'चक्की फ्रेश आटा', GR, [('1kg', 58), ('5kg', 275), ('10kg', 530)])
add('Fortune', 'फॉर्च्यून', 'Chakki Fresh Atta', 'चक्की फ्रेश आटा', GR, [('1kg', 55), ('5kg', 265), ('10kg', 515)])
add('Patanjali', 'पतंजली', 'Atta', 'आटा', GR, [('5kg', 250), ('10kg', 490)])
add('Annapurna', 'अन्नपूर्णा', 'Farm Fresh Atta', 'फार्म फ्रेश आटा', GR, [('5kg', 255), ('10kg', 495)])
add('Shakti Bhog', 'शक्ती भोग', 'Atta', 'आटा', GR, [('5kg', 245), ('10kg', 480)])
add('Rajdhani', 'राजधानी', 'Besan', 'बेसन', GR, [('500g', 65), ('1kg', 125)])
add('Tata Sampann', 'टाटा संपन्न', 'Besan', 'बेसन', GR, [('500g', 70), ('1kg', 135)])
add('Fortune', 'फॉर्च्यून', 'Besan', 'बेसन', GR, [('500g', 62), ('1kg', 120)])
add('Rajdhani', 'राजधानी', 'Sooji', 'रवा', GR, [('500g', 35), ('1kg', 65)])
add('Rajdhani', 'राजधानी', 'Maida', 'मैदा', GR, [('500g', 30), ('1kg', 55)])
add('Aashirvaad', 'आशीर्वाद', 'Sooji', 'रवा', GR, [('500g', 38)])
add('Pillsbury', 'पिल्सबरी', 'Maida', 'मैदा', GR, [('500g', 32), ('1kg', 58)])
add('Kellogg\'s', 'केलॉग्ज', 'Corn Flakes', 'कॉर्न फ्लेक्स', GR, [('250g', 125), ('475g', 220), ('875g', 380)])
add('Kellogg\'s', 'केलॉग्ज', 'Chocos', 'चोकोज', GR, [('250g', 150), ('385g', 230)])
add('Saffola', 'सफोला', 'Oats', 'ओट्स', GR, [('500g', 110), ('1kg', 199)])
add('Quaker', 'क्वेकर', 'Oats', 'ओट्स', GR, [('400g', 99), ('1kg', 210)])
add('Saffola', 'सफोला', 'Masala Oats', 'मसाला ओट्स', GR, [('38g', 15), ('500g', 199)])
add('Bambino', 'बँबिनो', 'Vermicelli', 'शेवया', GR, [('180g', 25), ('400g', 50), ('850g', 95)])
add('Anil', 'अनिल', 'Vermicelli', 'शेवया', GR, [('180g', 22), ('400g', 45)])
add('MTR', 'एमटीआर', 'Roasted Vermicelli', 'भाजलेल्या शेवया', GR, [('180g', 30), ('440g', 65)])
add('Tata', 'टाटा', 'Poha', 'पोहे', GR, [('500g', 45), ('1kg', 85)])
add('Gits', 'गिट्स', 'Gulab Jamun Mix', 'गुलाबजाम मिक्स', GR, [('100g', 70), ('200g', 135)])
add('MTR', 'एमटीआर', 'Gulab Jamun Mix', 'गुलाबजाम मिक्स', GR, [('175g', 120)])
add('MTR', 'एमटीआर', 'Rava Idli Mix', 'रवा इडली मिक्स', GR, [('200g', 70), ('500g', 165)])
add('MTR', 'एमटीआर', 'Dosa Mix', 'डोसा मिक्स', GR, [('200g', 70), ('500g', 160)])
add('Gits', 'गिट्स', 'Dhokla Mix', 'ढोकळा मिक्स', GR, [('200g', 75), ('500g', 165)])
add('Gits', 'गिट्स', 'Idli Mix', 'इडली मिक्स', GR, [('200g', 70)])
add('Chitale', 'चितळे', 'Bhajani', 'थालीपीठ भाजणी', GR, [('500g', 110)])
add('Chitale', 'चितळे', 'Chakli Bhajani', 'चकली भाजणी', GR, [('500g', 120)])
add('Weikfield', 'वीकफील्ड', 'Custard Powder', 'कस्टर्ड पावडर', GR, [('100g', 45), ('300g', 110)])
add('Weikfield', 'वीकफील्ड', 'Cornflour', 'कॉर्नफ्लोर', GR, [('100g', 30), ('500g', 105)])
add('Weikfield', 'वीकफील्ड', 'Baking Powder', 'बेकिंग पावडर', GR, [('50g', 35), ('100g', 60)])
add('', '', 'Soda Bicarb (Khaycha Soda)', 'खायचा सोडा', GR, [('100g', 20), ('500g', 70)])
add('Nutrela', 'न्यूट्रेला', 'Soya Chunks', 'सोया चंक्स', GR, [('200g', 45), ('1kg', 200)])
add('Fortune', 'फॉर्च्यून', 'Soya Chunks', 'सोया चंक्स', GR, [('200g', 42), ('1kg', 190)])

# ------------------------------------------------------------------ rice (packed)
add('India Gate', 'इंडिया गेट', 'Basmati Rice Classic', 'बासमती तांदूळ क्लासिक', RI, [('1kg', 230), ('5kg', 1050)])
add('India Gate', 'इंडिया गेट', 'Basmati Rice Super', 'बासमती तांदूळ सुपर', RI, [('1kg', 170), ('5kg', 780)])
add('India Gate', 'इंडिया गेट', 'Basmati Rice Feast Rozzana', 'बासमती तांदूळ रोज्जाना', RI, [('1kg', 110), ('5kg', 499)])
add('India Gate', 'इंडिया गेट', 'Basmati Rice Mogra', 'बासमती तांदूळ मोगरा', RI, [('1kg', 85), ('5kg', 399)])
add('Daawat', 'दावत', 'Basmati Rice Rozana', 'बासमती तांदूळ रोजाना', RI, [('1kg', 105), ('5kg', 480)])
add('Daawat', 'दावत', 'Basmati Rice Super', 'बासमती तांदूळ सुपर', RI, [('1kg', 150), ('5kg', 690)])
add('Daawat', 'दावत', 'Basmati Rice Traditional', 'बासमती तांदूळ ट्रॅडिशनल', RI, [('1kg', 210)])
add('Kohinoor', 'कोहिनूर', 'Basmati Rice Super Value', 'बासमती तांदूळ सुपर व्हॅल्यू', RI, [('1kg', 120), ('5kg', 550)])
add('Fortune', 'फॉर्च्यून', 'Biryani Special Basmati', 'बिर्याणी स्पेशल बासमती', RI, [('1kg', 160), ('5kg', 720)])
add('Tata Sampann', 'टाटा संपन्न', 'Kolam Rice', 'कोलम तांदूळ', RI, [('5kg', 360)])

# ------------------------------------------------------------------ dals (packed)
for b_en, b_mr, k in [('Tata Sampann', 'टाटा संपन्न', 1.12), ('Fortune', 'फॉर्च्यून', 1.04), ('Rajdhani', 'राजधानी', 1.0)]:
    for en, mr, p in [('Toor Dal', 'तूर डाळ', 175), ('Moong Dal', 'मूग डाळ', 140), ('Chana Dal', 'हरभरा डाळ', 105), ('Masoor Dal', 'मसूर डाळ', 110),
                      ('Urad Dal', 'उडीद डाळ', 155), ('Kabuli Chana', 'काबुली चणे', 160), ('Rajma', 'राजमा', 170)]:
        add(b_en, b_mr, en, mr, DAL, [('500g', round(p * k / 2 + 3)), ('1kg', round(p * k))])

# ------------------------------------------------------------------ oils & ghee
def oil(b_en, b_mr, en, mr, l1, extra=()):
    sizes = [('1L', l1), ('5L', round(l1 * 4.8))] + list(extra)
    add(b_en, b_mr, en, mr, OIL, sizes)
oil('Fortune', 'फॉर्च्यून', 'Sunlite Sunflower Oil', 'सनलाइट सूर्यफूल तेल', 165, [('15L', 2350)])
oil('Fortune', 'फॉर्च्यून', 'Soyabean Oil', 'सोयाबीन तेल', 150, [('15L', 2150)])
oil('Fortune', 'फॉर्च्यून', 'Groundnut Oil', 'शेंगदाणा तेल', 220)
oil('Fortune', 'फॉर्च्यून', 'Rice Bran Oil', 'राईस ब्रॅन तेल', 170)
oil('Fortune', 'फॉर्च्यून', 'Kachi Ghani Mustard Oil', 'कच्ची घाणी मोहरी तेल', 185)
oil('Saffola', 'सफोला', 'Gold Oil', 'गोल्ड तेल', 215)
oil('Saffola', 'सफोला', 'Tasty Oil', 'टेस्टी तेल', 190)
oil('Sundrop', 'सनड्रॉप', 'Heart Oil', 'हार्ट तेल', 175)
oil('Gemini', 'जेमिनी', 'Sunflower Oil', 'सूर्यफूल तेल', 160, [('15L', 2300)])
oil('Gemini', 'जेमिनी', 'Soyabean Oil', 'सोयाबीन तेल', 145, [('15L', 2100)])
oil('Kirti Gold', 'कीर्ती गोल्ड', 'Soyabean Oil', 'सोयाबीन तेल', 145, [('15L', 2100)])
oil('Kirti Gold', 'कीर्ती गोल्ड', 'Sunflower Oil', 'सूर्यफूल तेल', 160)
oil('Dhara', 'धारा', 'Mustard Oil', 'मोहरी तेल', 180)
oil('Dhara', 'धारा', 'Groundnut Oil', 'शेंगदाणा तेल', 215)
oil('Freedom', 'फ्रीडम', 'Sunflower Oil', 'सूर्यफूल तेल', 155)
oil('Tirupati', 'तिरुपती', 'Cottonseed Oil', 'सरकी तेल', 145)
oil('Engine', 'इंजिन', 'Kachi Ghani Mustard Oil', 'कच्ची घाणी मोहरी तेल', 175)
add('Parachute', 'पॅराशूट', 'Coconut Oil', 'खोबरेल तेल', HAIR, [('100ml', 55), ('200ml', 105), ('500ml', 240)])
add('Amul', 'अमूल', 'Pure Ghee', 'शुद्ध तूप', OIL, [('200ml', 140), ('500ml', 320), ('1L', 630)])
add('Gokul', 'गोकुळ', 'Ghee', 'तूप', OIL, [('200ml', 135), ('500ml', 310), ('1L', 610)])
add('Chitale', 'चितळे', 'Ghee', 'तूप', OIL, [('200g', 160), ('500g', 380), ('1kg', 740)])
add('Warana', 'वारणा', 'Ghee', 'तूप', OIL, [('200ml', 130), ('500ml', 300), ('1L', 590)])
add('Mahanand', 'महानंद', 'Ghee', 'तूप', OIL, [('500ml', 295), ('1L', 580)])
add('Govardhan', 'गोवर्धन', 'Ghee', 'तूप', OIL, [('500ml', 320), ('1L', 640)])
add('Patanjali', 'पतंजली', 'Cow Ghee', 'गाईचे तूप', OIL, [('500ml', 340), ('1L', 660)])
add('Dalda', 'डालडा', 'Vanaspati', 'वनस्पती तूप', OIL, [('500g', 85), ('1kg', 165)])

# ------------------------------------------------------------------ sugar, salt, jaggery
add('Tata', 'टाटा', 'Salt', 'मीठ', SUG, [('1kg', 28)])
add('Tata', 'टाटा', 'Salt Lite', 'मीठ लाइट', SUG, [('1kg', 50)])
add('Tata', 'टाटा', 'Rock Salt', 'सैंधव मीठ', SUG, [('1kg', 95)])
add('Aashirvaad', 'आशीर्वाद', 'Salt', 'मीठ', SUG, [('1kg', 27)])
add('Annapurna', 'अन्नपूर्णा', 'Salt', 'मीठ', SUG, [('1kg', 24)])
add('Catch', 'कॅच', 'Black Salt', 'काळे मीठ', SUG, [('100g', 25)])
add('Madhur', 'मधुर', 'Sugar', 'साखर', SUG, [('1kg', 60), ('5kg', 285)])
add('Trust', 'ट्रस्ट', 'Sugar', 'साखर', SUG, [('1kg', 58), ('5kg', 280)])
add('Dhampure', 'धामपूर', 'Sugar', 'साखर', SUG, [('1kg', 60)])
add('', '', 'Jaggery Cubes', 'गूळ क्यूब्स', SUG, [('500g', 55), ('1kg', 100)])
add('Dabur', 'डाबर', 'Honey', 'मध', SUG, [('250g', 125), ('500g', 235), ('1kg', 425)])
add('Patanjali', 'पतंजली', 'Honey', 'मध', SUG, [('250g', 95), ('500g', 180), ('1kg', 340)])

# ------------------------------------------------------------------ masale (packed)
for b_en, b_mr, k in [('Everest', 'एव्हरेस्ट', 1.0), ('MDH', 'एमडीएच', 1.05), ('Catch', 'कॅच', 0.98)]:
    for en, mr, p100 in [('Garam Masala', 'गरम मसाला', 95), ('Kitchen King', 'किचन किंग', 85), ('Chhole Masala', 'छोले मसाला', 80),
                         ('Pav Bhaji Masala', 'पावभाजी मसाला', 85), ('Chicken Masala', 'चिकन मसाला', 85), ('Meat Masala', 'मटण मसाला', 90),
                         ('Sambhar Masala', 'सांबार मसाला', 80), ('Chaat Masala', 'चाट मसाला', 75), ('Biryani Masala', 'बिर्याणी मसाला', 90),
                         ('Kasuri Methi', 'कसुरी मेथी', 45), ('Jeera Powder', 'जिरे पावडर', 90)]:
        add(b_en, b_mr, en, mr, MAS, [('50g', round(p100 * k / 2 + 3)), ('100g', round(p100 * k))])
    for en, mr, p in [('Turmeric Powder', 'हळद पावडर', 70), ('Chilli Powder', 'मिरची पावडर', 95), ('Coriander Powder', 'धणे पावडर', 60)]:
        add(b_en, b_mr, en, mr, MAS, [('100g', round(p * k)), ('200g', round(p * 1.9 * k)), ('500g', round(p * 4.5 * k))])
for b_en, b_mr in [('Suhana', 'सुहाना'), ('Pravin', 'प्रवीण'), ('Badshah', 'बादशाह'), ('Ram Bandhu', 'राम बंधू'), ('Kesari', 'केसरी')]:
    for en, mr, p in [('Goda Masala', 'गोडा मसाला', 60), ('Kanda Lasun Masala', 'कांदा लसूण मसाला', 65), ('Kolhapuri Masala', 'कोल्हापुरी मसाला', 65),
                      ('Malvani Masala', 'मालवणी मसाला', 65), ('Misal Masala', 'मिसळ मसाला', 55), ('Pav Bhaji Masala', 'पावभाजी मसाला', 60),
                      ('Garam Masala', 'गरम मसाला', 70), ('Chicken Masala', 'चिकन मसाला', 60), ('Mutton Masala', 'मटण मसाला', 65),
                      ('Biryani Masala', 'बिर्याणी मसाला', 60), ('Sambhar Masala', 'सांबार मसाला', 55)]:
        add(b_en, b_mr, en, mr, MAS, [('100g', p), ('200g', round(p * 1.9))])
add('Ram Bandhu', 'राम बंधू', 'Lonche Masala', 'लोणचे मसाला', MAS, [('100g', 50)])
add('Bedekar', 'बेडेकर', 'Lonche Masala', 'लोणचे मसाला', MAS, [('100g', 55), ('500g', 240)])
add('Bedekar', 'बेडेकर', 'Goda Masala', 'गोडा मसाला', MAS, [('100g', 70)])
add('LG', 'एलजी', 'Hing Powder', 'हिंग पावडर', MAS, [('25g', 70), ('50g', 130), ('100g', 245)])
add('Everest', 'एव्हरेस्ट', 'Hing Compounded', 'हिंग', MAS, [('25g', 85), ('50g', 160)])
add('MDH', 'एमडीएच', 'Deggi Mirch', 'देगी मिर्च', MAS, [('100g', 98), ('500g', 470)])
add('Everest', 'एव्हरेस्ट', 'Tikhalal Chilli Powder', 'तिखालाल मिरची पावडर', MAS, [('100g', 80), ('500g', 370)])
add('Catch', 'कॅच', 'Black Pepper Powder', 'काळी मिरी पावडर', MAS, [('50g', 85), ('100g', 160)])
add('', '', 'Jeera Packet', 'जिरे पाकीट', MAS, [('50g', 25), ('100g', 48), ('200g', 95)])
add('', '', 'Mohari Packet', 'मोहरी पाकीट', MAS, [('50g', 8), ('100g', 15)])
add('', '', 'Elaichi Packet', 'वेलची पाकीट', MAS, [('10g', 35), ('25g', 85)])

# ------------------------------------------------------------------ tea & coffee
for b_en, b_mr, items in [
    ('Tata Tea', 'टाटा टी', [('Premium', 'प्रीमियम', 0.62), ('Agni', 'अग्नी', 0.48), ('Gold', 'गोल्ड', 0.75), ('Chakra Gold', 'चक्र गोल्ड', 0.55)]),
    ('Brooke Bond', 'ब्रुक बॉण्ड', [('Red Label', 'रेड लेबल', 0.62), ('Taj Mahal', 'ताजमहाल', 0.90), ('Taaza', 'ताझा', 0.50), ('3 Roses', 'थ्री रोझेस', 0.60)]),
    ('Society', 'सोसायटी', [('Tea', 'चहा', 0.62), ('Masala Tea', 'मसाला चहा', 0.70)]),
    ('Wagh Bakri', 'वाघ बकरी', [('Premium Tea', 'प्रीमियम चहा', 0.62), ('Masala Tea', 'मसाला चहा', 0.68)]),
    ('Girnar', 'गिरनार', [('Tea', 'चहा', 0.60)]),
    ('Gemini', 'जेमिनी', [('Tea', 'चहा', 0.52)]),
    ('Sapat', 'सपट', [('Parivar Tea', 'परिवार चहा', 0.52)]),
    ('Lipton', 'लिप्टन', [('Green Tea', 'ग्रीन टी', 2.0)])]:
    for en, mr, per_g in items:
        add(b_en, b_mr, en, mr, TEA, [('100g', round(per_g * 100 + 5)), ('250g', round(per_g * 250)), ('500g', round(per_g * 490)), ('1kg', round(per_g * 960))])
add('Nescafe', 'नेसकॅफे', 'Classic Coffee', 'क्लासिक कॉफी', TEA, [('2g', 2), ('25g', 95), ('50g', 180), ('100g', 340)])
add('Nescafe', 'नेसकॅफे', 'Sunrise Coffee', 'सनराइज कॉफी', TEA, [('50g', 135), ('100g', 255)])
add('Bru', 'ब्रू', 'Instant Coffee', 'इन्स्टंट कॉफी', TEA, [('2g', 2), ('50g', 130), ('100g', 240)])
add('Bru', 'ब्रू', 'Gold Coffee', 'गोल्ड कॉफी', TEA, [('50g', 200)])
add('Continental', 'कॉन्टिनेंटल', 'Coffee', 'कॉफी', TEA, [('50g', 110)])
add('Bournvita', 'बोर्नव्हिटा', '', '', TEA, [('500g', 245), ('1kg', 465)])
add('Horlicks', 'हॉर्लिक्स', 'Classic Malt', 'क्लासिक माल्ट', TEA, [('500g', 255), ('1kg', 480)])
add('Boost', 'बूस्ट', '', '', TEA, [('500g', 255)])
add('Complan', 'कॉम्प्लान', 'Chocolate', 'चॉकलेट', TEA, [('500g', 299)])
add('Protinex', 'प्रोटीनेक्स', 'Original', 'ओरिजिनल', HEALTH, [('250g', 700)])

# ------------------------------------------------------------------ biscuits
for b_en, b_mr, en, mr, sizes in [
    ('Parle', 'पार्ले', 'G', 'जी', [('50g', 5), ('100g', 10), ('250g', 25), ('800g', 80)]),
    ('Parle', 'पार्ले', 'Hide & Seek', 'हाईड अँड सीक', [('100g', 30), ('200g', 60)]),
    ('Parle', 'पार्ले', 'Monaco', 'मोनॅको', [('70g', 10), ('200g', 35)]),
    ('Parle', 'पार्ले', 'Krackjack', 'क्रॅकजॅक', [('70g', 10), ('200g', 35)]),
    ('Parle', 'पार्ले', 'Marie', 'मारी', [('250g', 30)]),
    ('Parle', 'पार्ले', 'Happy Happy', 'हॅपी हॅपी', [('50g', 10)]),
    ('Parle', 'पार्ले', '20-20 Cookies', '20-20 कुकीज', [('100g', 20)]),
    ('Parle', 'पार्ले', 'Milano', 'मिलानो', [('75g', 40)]),
    ('Britannia', 'ब्रिटानिया', 'Good Day Cashew', 'गुड डे काजू', [('50g', 10), ('100g', 20), ('200g', 40)]),
    ('Britannia', 'ब्रिटानिया', 'Good Day Butter', 'गुड डे बटर', [('50g', 10), ('100g', 20)]),
    ('Britannia', 'ब्रिटानिया', 'Marie Gold', 'मारी गोल्ड', [('100g', 15), ('250g', 35)]),
    ('Britannia', 'ब्रिटानिया', 'Bourbon', 'बोर्बन', [('100g', 30), ('150g', 40)]),
    ('Britannia', 'ब्रिटानिया', 'Tiger Glucose', 'टायगर ग्लुकोज', [('50g', 5), ('100g', 10)]),
    ('Britannia', 'ब्रिटानिया', 'NutriChoice Digestive', 'न्यूट्रिचॉइस डायजेस्टिव', [('100g', 25), ('250g', 60)]),
    ('Britannia', 'ब्रिटानिया', '50-50', '50-50', [('60g', 10), ('150g', 30)]),
    ('Britannia', 'ब्रिटानिया', 'Milk Bikis', 'मिल्क बिकिस', [('100g', 15)]),
    ('Britannia', 'ब्रिटानिया', 'Jim Jam', 'जिम जॅम', [('100g', 30)]),
    ('Britannia', 'ब्रिटानिया', 'Treat', 'ट्रीट', [('60g', 10)]),
    ('Britannia', 'ब्रिटानिया', 'Rusk', 'रस्क (टोस्ट)', [('200g', 40), ('300g', 55)]),
    ('Britannia', 'ब्रिटानिया', 'Cake', 'केक', [('15g', 5), ('50g', 20)]),
    ('Britannia', 'ब्रिटानिया', 'Bread', 'ब्रेड', [('400g', 45)]),
    ('Sunfeast', 'सनफीस्ट', 'Dark Fantasy', 'डार्क फँटसी', [('75g', 40), ('150g', 75)]),
    ('Sunfeast', 'सनफीस्ट', 'Marie Light', 'मारी लाइट', [('150g', 20), ('250g', 35)]),
    ('Sunfeast', 'सनफीस्ट', 'Mom\'s Magic', 'मॉम्स मॅजिक', [('75g', 20)]),
    ('Sunfeast', 'सनफीस्ट', 'Bounce', 'बाउन्स', [('60g', 10)]),
    ('Sunfeast', 'सनफीस्ट', 'Glucose', 'ग्लुकोज', [('100g', 10)]),
    ('Oreo', 'ओरिओ', 'Original', 'ओरिजिनल', [('50g', 10), ('120g', 35)]),
    ('Priyagold', 'प्रियागोल्ड', 'Butter Bite', 'बटर बाईट', [('100g', 10)]),
    ('Anmol', 'अनमोल', 'Biscuits', 'बिस्किटे', [('100g', 10)]),
    ('McVitie\'s', 'मॅकव्हिटीज', 'Digestive', 'डायजेस्टिव', [('250g', 70)])]:
    add(b_en, b_mr, en, mr, BIS, sizes)
add('', '', 'Khari', 'खारी', BIS, [('200g', 40)])
add('', '', 'Toast', 'टोस्ट', BIS, [('200g', 35)])
add('', '', 'Pav', 'पाव', BIS, [('6pc', 25)])

# ------------------------------------------------------------------ namkeen & snacks
for b_en, b_mr, items in [
    ('Haldiram\'s', 'हल्दीराम', [('Aloo Bhujia', 'आलू भुजिया'), ('Bhujia Sev', 'भुजिया शेव'), ('Navratan Mix', 'नवरतन मिक्स'), ('Moong Dal', 'मूग डाळ'),
                                ('Khatta Meetha', 'खट्टा मीठा'), ('Salted Peanuts', 'खारे शेंगदाणे'), ('Panchratan', 'पंचरत्न'), ('Cornflakes Mixture', 'कॉर्नफ्लेक्स चिवडा')]),
    ('Balaji', 'बालाजी', [('Ratlami Sev', 'रतलामी शेव'), ('Chataka Pataka', 'चटाका पटाका'), ('Wafers Masala Masti', 'वेफर्स मसाला मस्ती'), ('Bhavnagri Gathiya', 'भावनगरी गाठिया')]),
    ('Bikaji', 'बिकाजी', [('Bikaneri Bhujia', 'बिकानेरी भुजिया'), ('Mini Samosa', 'मिनी समोसा'), ('Khatta Meetha', 'खट्टा मीठा')]),
    ('Chitale', 'चितळे', [('Bakarwadi', 'बाकरवडी'), ('Chakli', 'चकली'), ('Chivda', 'चिवडा'), ('Shev', 'शेव')]),
    ('Laxminarayan', 'लक्ष्मीनारायण', [('Chivda', 'चिवडा'), ('Bakarwadi', 'बाकरवडी')]),
    ('Bhagat', 'भगत', [('Nashik Chivda', 'नाशिक चिवडा')])]:
    for en, mr in items:
        add(b_en, b_mr, en, mr, SNK, [('150g', 50), ('200g', 60), ('400g', 110), ('1kg', 260)] if b_en == 'Haldiram\'s' else [('200g', 60), ('500g', 140)])
for b_en, b_mr, items in [
    ('Lay\'s', 'लेज', [('Classic Salted', 'क्लासिक सॉल्टेड'), ('Magic Masala', 'मॅजिक मसाला'), ('American Cream & Onion', 'क्रीम अँड ओनियन'), ('Spanish Tomato', 'टोमॅटो')]),
    ('Kurkure', 'कुरकुरे', [('Masala Munch', 'मसाला मंच'), ('Chilli Chatka', 'चिली चटका'), ('Solid Masti', 'सॉलिड मस्ती')]),
    ('Uncle Chipps', 'अंकल चिप्स', [('Spicy Treat', 'स्पायसी ट्रीट'), ('Plain Salted', 'प्लेन सॉल्टेड')]),
    ('Bingo', 'बिंगो', [('Mad Angles', 'मॅड अँगल्स'), ('Tedhe Medhe', 'टेढे मेढे')]),
    ('Doritos', 'डोरिटोस', [('Nacho Cheese', 'नाचो चीज')]),
    ('Cornitos', 'कॉर्निटोस', [('Nachos', 'नाचोज')]),
    ('Balaji', 'बालाजी', [('Simply Salted Wafers', 'सॉल्टेड वेफर्स'), ('Tomato Wafers', 'टोमॅटो वेफर्स')]),
    ('Too Yumm', 'टू यम', [('Multigrain Chips', 'मल्टीग्रेन चिप्स')])]:
    for en, mr in items:
        add(b_en, b_mr, en, mr, SNK, [('25g', 10), ('50g', 20), ('90g', 50)])
add('Pringles', 'प्रिंगल्स', 'Original', 'ओरिजिनल', SNK, [('107g', 115)])
add('Act II', 'ॲक्ट II', 'Popcorn Butter', 'पॉपकॉर्न बटर', SNK, [('30g', 10), ('70g', 30)])
add('', '', 'Farsan Mix', 'फरसाण', SNK, [('250g', 60), ('500g', 115)])
add('', '', 'Chakli', 'चकली', SNK, [('200g', 60)])
add('', '', 'Papdi Gathiya', 'पापडी गाठिया', SNK, [('250g', 60)])

# ------------------------------------------------------------------ chocolate & sweets
for b_en, b_mr, en, mr, sizes in [
    ('Cadbury', 'कॅडबरी', 'Dairy Milk', 'डेअरी मिल्क', [('13g', 10), ('23g', 20), ('50g', 50), ('110g', 100)]),
    ('Cadbury', 'कॅडबरी', 'Dairy Milk Silk', 'डेअरी मिल्क सिल्क', [('60g', 90), ('150g', 190)]),
    ('Cadbury', 'कॅडबरी', '5 Star', '5 स्टार', [('12g', 10), ('22g', 20)]),
    ('Cadbury', 'कॅडबरी', 'Perk', 'पर्क', [('13g', 10)]),
    ('Cadbury', 'कॅडबरी', 'Gems', 'जेम्स', [('8g', 10)]),
    ('Cadbury', 'कॅडबरी', 'Celebrations', 'सेलिब्रेशन्स', [('118g', 150), ('196g', 250)]),
    ('Nestle', 'नेस्ले', 'KitKat', 'किटकॅट', [('13g', 10), ('27g', 25)]),
    ('Nestle', 'नेस्ले', 'Munch', 'मंच', [('9g', 5), ('19g', 10)]),
    ('Amul', 'अमूल', 'Dark Chocolate', 'डार्क चॉकलेट', [('40g', 50), ('150g', 200)]),
    ('Mondelez', 'मोंडेलेझ', 'Bournville', 'बोर्नव्हिल', [('31g', 50), ('80g', 110)]),
    ('Ferrero', 'फेरेरो', 'Rocher', 'रोशे', [('3pc', 130), ('16pc', 650)]),
    ('Pulse', 'पल्स', 'Candy', 'कँडी', [('1pc', 1), ('100pc', 100)]),
    ('Alpenliebe', 'अल्पेनलिबे', 'Candy', 'कँडी', [('1pc', 1), ('100pc', 100)]),
    ('Eclairs', 'एक्लेयर्स', 'Candy', 'कँडी', [('1pc', 1), ('100pc', 100)]),
    ('Mentos', 'मेंटॉस', 'Roll', 'रोल', [('1pc', 10)]),
    ('Center Fresh', 'सेंटर फ्रेश', 'Gum', 'गम', [('1pc', 1)]),
    ('Polo', 'पोलो', 'Mint', 'मिंट', [('1pc', 10)]),
    ('Haldiram\'s', 'हल्दीराम', 'Soan Papdi', 'सोनपापडी', [('250g', 85), ('500g', 160)]),
    ('Haldiram\'s', 'हल्दीराम', 'Rasgulla Tin', 'रसगुल्ला डबा', [('1kg', 250)]),
    ('Haldiram\'s', 'हल्दीराम', 'Gulab Jamun Tin', 'गुलाबजाम डबा', [('1kg', 250)]),
    ('Chitale', 'चितळे', 'Shrikhand', 'श्रीखंड', [('250g', 90), ('500g', 170)]),
    ('Chitale', 'चितळे', 'Amrakhand', 'आम्रखंड', [('250g', 95), ('500g', 180)])]:
    add(b_en, b_mr, en, mr, CHO, sizes)

# ------------------------------------------------------------------ milk & dairy
for b_en, b_mr in [('Gokul', 'गोकुळ'), ('Amul', 'अमूल'), ('Chitale', 'चितळे'), ('Warana', 'वारणा'), ('Mahanand', 'महानंद'), ('Katraj', 'कात्रज'), ('Govardhan', 'गोवर्धन')]:
    add(b_en, b_mr, 'Full Cream Milk', 'फुल क्रीम दूध', MLK, [('500ml', 36), ('1L', 70)])
    add(b_en, b_mr, 'Toned Milk', 'टोन्ड दूध', MLK, [('500ml', 28), ('1L', 56)])
    add(b_en, b_mr, 'Cow Milk', 'गाईचे दूध', MLK, [('500ml', 30)])
    add(b_en, b_mr, 'Dahi', 'दही', MLK, [('200g', 25), ('400g', 45), ('1kg', 95)])
    add(b_en, b_mr, 'Taak (Buttermilk)', 'ताक', MLK, [('200ml', 12), ('500ml', 25)])
    add(b_en, b_mr, 'Paneer', 'पनीर', MLK, [('200g', 95), ('1kg', 440)])
add('Amul', 'अमूल', 'Butter', 'बटर (लोणी)', MLK, [('100g', 60), ('500g', 285)])
add('Amul', 'अमूल', 'Cheese Slices', 'चीज स्लाइस', MLK, [('200g', 150)])
add('Amul', 'अमूल', 'Cheese Cubes', 'चीज क्यूब्स', MLK, [('200g', 140)])
add('Amul', 'अमूल', 'Fresh Cream', 'फ्रेश क्रीम', MLK, [('250ml', 70)])
add('Amul', 'अमूल', 'Kool', 'कूल', MLK, [('180ml', 30)])
add('Amul', 'अमूल', 'Lassi', 'लस्सी', MLK, [('200ml', 25)])
add('Amul', 'अमूल', 'Masti Buttermilk', 'मस्ती ताक', MLK, [('200ml', 15), ('500ml', 30)])
add('Amul', 'अमूल', 'Gold Milk', 'गोल्ड दूध', MLK, [('500ml', 34), ('1L', 68)])
add('Amul', 'अमूल', 'Taaza Tetra Milk', 'ताझा दूध टेट्रा', MLK, [('1L', 76)])
add('Amul', 'अमूल', 'Milk Powder (Amulya)', 'दूध पावडर (अमूल्या)', MLK, [('500g', 260), ('1kg', 500)])
add('Amul', 'अमूल', 'Mithai Mate', 'मिठाई मेट', MLK, [('200g', 120), ('400g', 160)])
add('Nestle', 'नेस्ले', 'Everyday Dairy Whitener', 'एव्हरीडे डेअरी व्हाईटनर', MLK, [('200g', 120), ('400g', 230), ('1kg', 520)])
add('Nestle', 'नेस्ले', 'Milkmaid', 'मिल्कमेड', MLK, [('380g', 150)])
add('Britannia', 'ब्रिटानिया', 'Cheese Slices', 'चीज स्लाइस', MLK, [('200g', 145)])
add('Mother Dairy', 'मदर डेअरी', 'Dahi', 'दही', MLK, [('400g', 50)])
add('', '', 'Eggs', 'अंडी', MLK, [('6pc', 42), ('30pc', 200)], 'piece')

# ------------------------------------------------------------------ beverages
for b_en, b_mr, sizes in [
    ('Thums Up', 'थम्स अप', [('250ml', 20), ('750ml', 40), ('2L', 95)]), ('Coca-Cola', 'कोका कोला', [('250ml', 20), ('750ml', 40), ('2L', 95)]),
    ('Sprite', 'स्प्राइट', [('250ml', 20), ('750ml', 40), ('2L', 95)]), ('Fanta', 'फॅन्टा', [('250ml', 20), ('750ml', 40)]),
    ('Limca', 'लिम्का', [('250ml', 20), ('750ml', 40)]), ('Pepsi', 'पेप्सी', [('250ml', 20), ('750ml', 40), ('2L', 95)]),
    ('Mountain Dew', 'माउंटन ड्यू', [('250ml', 20), ('750ml', 40)]), ('7Up', '7अप', [('250ml', 20), ('750ml', 40)]),
    ('Mirinda', 'मिरिंडा', [('250ml', 20), ('750ml', 40)]), ('Campa Cola', 'कॅम्पा कोला', [('200ml', 10), ('500ml', 20), ('2L', 49)]),
    ('Maaza', 'माझा', [('250ml', 20), ('600ml', 40), ('1.2L', 75)]), ('Frooti', 'फ्रूटी', [('125ml', 10), ('200ml', 20), ('600ml', 40)]),
    ('Slice', 'स्लाइस', [('200ml', 20), ('600ml', 40)]), ('Appy Fizz', 'ॲपी फिझ', [('250ml', 25)]),
    ('Sting', 'स्टिंग', [('250ml', 20)]), ('Red Bull', 'रेड बुल', [('250ml', 125)]),
    ('Bisleri', 'बिसलेरी', [('500ml', 10), ('1L', 20), ('2L', 30), ('5L', 70)]), ('Kinley', 'किन्ले', [('500ml', 10), ('1L', 20)]),
    ('Aquafina', 'ॲक्वाफिना', [('500ml', 10), ('1L', 20)]),
    ('Real', 'रिअल', [('1L', 130)]), ('Tropicana', 'ट्रॉपिकाना', [('1L', 120)]),
    ('Paper Boat', 'पेपर बोट', [('200ml', 30)]), ('Glucon-D', 'ग्लुकॉन-डी', [('125g', 50), ('500g', 175)]),
    ('Tang', 'टँग', [('500g', 160)]), ('Rasna', 'रसना', [('32g', 10)]), ('Rooh Afza', 'रूह अफजा', [('750ml', 175)]),
    ('Kissan', 'किसान', [('700ml', 160)])]:
    add(b_en, b_mr, '', '', BEV, sizes, 'piece')
add('Electral', 'इलेक्ट्रॉल', 'ORS', 'ओआरएस', BEV, [('21g', 22)], 'piece')
add('', '', 'Soda', 'सोडा', BEV, [('600ml', 20)], 'piece')

# ------------------------------------------------------------------ noodles & instant
add('Maggi', 'मॅगी', 'Masala Noodles', 'मसाला नूडल्स', NDL, [('70g', 14), ('140g', 28), ('280g', 56), ('560g', 108)])
add('Maggi', 'मॅगी', 'Atta Noodles', 'आटा नूडल्स', NDL, [('80g', 25), ('290g', 75)])
add('Maggi', 'मॅगी', 'Hot Heads', 'हॉट हेड्स', NDL, [('71g', 35)])
add('Maggi', 'मॅगी', 'Masala-ae-Magic', 'मसाला-ए-मॅजिक', MAS, [('6g', 5), ('72g', 55)])
add('Maggi', 'मॅगी', 'Tomato Ketchup', 'टोमॅटो केचप', SAU, [('200g', 60), ('500g', 130), ('1kg', 175)])
add('Maggi', 'मॅगी', 'Hot & Sweet Sauce', 'हॉट अँड स्वीट सॉस', SAU, [('500g', 140)])
add('Yippee', 'यिप्पी', 'Magic Masala Noodles', 'मॅजिक मसाला नूडल्स', NDL, [('60g', 14), ('240g', 56), ('360g', 84)])
add('Top Ramen', 'टॉप रामेन', 'Curry Noodles', 'करी नूडल्स', NDL, [('70g', 14), ('280g', 56)])
add('Ching\'s', 'चिंग्ज', 'Schezwan Noodles', 'शेझवान नूडल्स', NDL, [('60g', 15), ('240g', 60)])
add('Ching\'s', 'चिंग्ज', 'Hakka Noodles', 'हक्का नूडल्स', NDL, [('150g', 40)])
add('Ching\'s', 'चिंग्ज', 'Schezwan Chutney', 'शेझवान चटणी', SAU, [('250g', 99)])
add('Ching\'s', 'चिंग्ज', 'Dark Soy Sauce', 'सोया सॉस', SAU, [('200g', 55)])
add('Ching\'s', 'चिंग्ज', 'Green Chilli Sauce', 'ग्रीन चिली सॉस', SAU, [('200g', 55)])
add('Ching\'s', 'चिंग्ज', 'Manchurian Soup', 'मंचुरियन सूप', NDL, [('15g', 10)])
add('Knorr', 'नॉर', 'Tomato Soup', 'टोमॅटो सूप', NDL, [('53g', 60)])
add('Knorr', 'नॉर', 'Hot & Sour Soup', 'हॉट अँड सॉर सूप', NDL, [('43g', 60)])
add('Wai Wai', 'वाई वाई', 'Noodles', 'नूडल्स', NDL, [('70g', 15)])
add('Bambino', 'बँबिनो', 'Macaroni', 'मॅकरोनी', NDL, [('400g', 55)])
add('Sunfeast', 'सनफीस्ट', 'Yippee Pasta Treat', 'पास्ता ट्रीट', NDL, [('70g', 25)])
add('MTR', 'एमटीआर', 'Upma Breakfast Mix', 'उपमा मिक्स', NDL, [('180g', 70)])
add('MTR', 'एमटीआर', 'Poha Breakfast Mix', 'पोहे मिक्स', NDL, [('180g', 70)])

# ------------------------------------------------------------------ sauces, pickles, papad, spreads
add('Kissan', 'किसान', 'Fresh Tomato Ketchup', 'टोमॅटो केचप', SAU, [('200g', 55), ('500g', 120), ('950g', 165)])
add('Kissan', 'किसान', 'Mixed Fruit Jam', 'मिक्स फ्रूट जॅम', SAU, [('200g', 75), ('500g', 165)])
add('Tops', 'टॉप्स', 'Tomato Ketchup', 'टोमॅटो केचप', SAU, [('1kg', 150)])
add('Del Monte', 'डेल मॉन्टे', 'Tomato Ketchup', 'टोमॅटो केचप', SAU, [('950g', 150)])
add('Veeba', 'वीबा', 'Mayonnaise', 'मेयोनीज', SAU, [('250g', 99)])
add('Funfoods', 'फनफूड्स', 'Mayonnaise', 'मेयोनीज', SAU, [('275g', 99)])
add('Nutella', 'न्युटेला', 'Spread', 'स्प्रेड', SAU, [('180g', 350)])
add('Sundrop', 'सनड्रॉप', 'Peanut Butter', 'पीनट बटर', SAU, [('200g', 120), ('462g', 230)])
for b_en, b_mr in [('Bedekar', 'बेडेकर'), ('Pravin', 'प्रवीण'), ('Mother\'s Recipe', 'मदर्स रेसिपी'), ('Ram Bandhu', 'राम बंधू'), ('Priya', 'प्रिया')]:
    for en, mr in [('Mango Pickle', 'कैरी लोणचे'), ('Lime Pickle', 'लिंबू लोणचे'), ('Mixed Pickle', 'मिक्स लोणचे')]:
        add(b_en, b_mr, en, mr, SAU, [('200g', 60), ('500g', 130), ('1kg', 240)])
add('Lijjat', 'लिज्जत', 'Udad Papad', 'उडीद पापड', SAU, [('200g', 70), ('400g', 135)])
add('Lijjat', 'लिज्जत', 'Moong Papad', 'मूग पापड', SAU, [('200g', 70)])
add('Lijjat', 'लिज्जत', 'Punjabi Masala Papad', 'पंजाबी मसाला पापड', SAU, [('200g', 75)])
add('', '', 'Nagli Papad', 'नाचणी पापड', SAU, [('200g', 60)])
add('', '', 'Sabudana Papad', 'साबुदाणा पापड', SAU, [('200g', 60)])
add('', '', 'Kurdai', 'कुरडई', SAU, [('250g', 80)])
add('', '', 'Vinegar', 'व्हिनेगर', SAU, [('610ml', 40)])
add('Dr. Oetker', 'डॉ. ओटकर', 'Vanilla Essence', 'व्हॅनिला इसेन्स', SAU, [('20ml', 30)])
add('', '', 'Food Colour', 'खाण्याचा रंग', SAU, [('10g', 15)])

# ------------------------------------------------------------------ dry fruits (packed)
for en, mr, p250 in [('Almonds', 'बदाम', 240), ('Cashew', 'काजू', 260), ('Raisins', 'मनुका', 110), ('Pista', 'पिस्ता', 480), ('Walnut Kernels', 'अक्रोड गर', 380), ('Anjeer', 'अंजीर', 350), ('Makhana', 'मखाना', 300)]:
    add('Happilo', 'हॅपिलो', en, mr, DRY, [('200g', round(p250 * 0.85)), ('500g', round(p250 * 1.95))])
    add('', '', en + ' Packet', mr + ' पाकीट', DRY, [('100g', round(p250 * 0.42)), ('250g', p250)])
add('Lion', 'लायन', 'Dates', 'खजूर', DRY, [('500g', 160)])

# ------------------------------------------------------------------ washing
for b_en, b_mr, en, mr, sizes in [
    ('Surf Excel', 'सर्फ एक्सेल', 'Easy Wash', 'इझी वॉश', [('500g', 75), ('1kg', 140), ('3kg', 390)]),
    ('Surf Excel', 'सर्फ एक्सेल', 'Quick Wash', 'क्विक वॉश', [('500g', 120), ('1kg', 235)]),
    ('Surf Excel', 'सर्फ एक्सेल', 'Matic Liquid', 'मॅटिक लिक्विड', [('500ml', 135), ('1L', 255)]),
    ('Surf Excel', 'सर्फ एक्सेल', 'Bar', 'बार', [('90g', 10), ('250g', 35)]),
    ('Ariel', 'एरियल', 'Complete Detergent', 'कंप्लीट डिटर्जंट', [('500g', 130), ('1kg', 250)]),
    ('Ariel', 'एरियल', 'Matic Liquid', 'मॅटिक लिक्विड', [('1L', 260)]),
    ('Tide', 'टाइड', 'Plus Detergent', 'प्लस डिटर्जंट', [('500g', 60), ('1kg', 115), ('4kg', 440)]),
    ('Tide', 'टाइड', 'Bar', 'बार', [('150g', 12)]),
    ('Rin', 'रिन', 'Detergent Powder', 'डिटर्जंट पावडर', [('500g', 50), ('1kg', 95)]),
    ('Rin', 'रिन', 'Bar', 'बार', [('140g', 10), ('250g', 20)]),
    ('Wheel', 'व्हील', 'Detergent Powder', 'डिटर्जंट पावडर', [('500g', 40), ('1kg', 75), ('2kg', 145)]),
    ('Wheel', 'व्हील', 'Bar', 'बार', [('125g', 10)]),
    ('Nirma', 'निरमा', 'Washing Powder', 'वॉशिंग पावडर', [('500g', 35), ('1kg', 65)]),
    ('Nirma', 'निरमा', 'Bar', 'बार', [('150g', 10)]),
    ('Ghadi', 'घडी', 'Detergent Powder', 'डिटर्जंट पावडर', [('500g', 35), ('1kg', 70), ('2kg', 135)]),
    ('Ghadi', 'घडी', 'Bar', 'बार', [('150g', 10)]),
    ('Henko', 'हेन्को', 'Detergent', 'डिटर्जंट', [('1kg', 150)]),
    ('Fena', 'फेना', 'Detergent', 'डिटर्जंट', [('500g', 40), ('1kg', 75)]),
    ('Sasa', 'ससा', 'Detergent Powder', 'डिटर्जंट पावडर', [('1kg', 65)]),
    ('Comfort', 'कम्फर्ट', 'Fabric Conditioner', 'फॅब्रिक कंडिशनर', [('220ml', 55), ('860ml', 230)]),
    ('Robin', 'रॉबिन', 'Blue (Neel)', 'नीळ', [('75ml', 20), ('150ml', 35)]),
    ('Ujala', 'उजाला', 'Supreme', 'सुप्रीम', [('75ml', 30), ('250ml', 85)]),
    ('Vanish', 'व्हॅनिश', 'Liquid', 'लिक्विड', [('180ml', 85)]),
    ('Genteel', 'जेंटील', 'Liquid', 'लिक्विड', [('500ml', 135)])]:
    add(b_en, b_mr, en, mr, WASH, sizes)

# ------------------------------------------------------------------ home cleaning
for b_en, b_mr, en, mr, sizes in [
    ('Vim', 'विम', 'Bar', 'बार', [('80g', 10), ('200g', 20), ('3pc', 60)]),
    ('Vim', 'विम', 'Liquid Gel', 'लिक्विड जेल', [('250ml', 55), ('500ml', 110), ('750ml', 155)]),
    ('Pril', 'प्रिल', 'Liquid', 'लिक्विड', [('425ml', 99)]),
    ('Exo', 'एक्सो', 'Bar', 'बार', [('80g', 10), ('200g', 20)]),
    ('Pitambari', 'पितांबरी', 'Powder', 'पावडर', [('100g', 35), ('200g', 65), ('500g', 150)]),
    ('Harpic', 'हार्पिक', 'Toilet Cleaner', 'टॉयलेट क्लीनर', [('200ml', 49), ('500ml', 99), ('1L', 195)]),
    ('Domex', 'डोमेक्स', 'Toilet Cleaner', 'टॉयलेट क्लीनर', [('500ml', 99)]),
    ('Lizol', 'लायझॉल', 'Floor Cleaner', 'फ्लोअर क्लीनर', [('200ml', 49), ('500ml', 115), ('975ml', 210)]),
    ('Colin', 'कॉलिन', 'Glass Cleaner', 'ग्लास क्लीनर', [('250ml', 85), ('500ml', 115)]),
    ('Phenyl', 'फिनाईल', 'White', 'पांढरे', [('500ml', 40), ('1L', 75), ('5L', 300)]),
    ('Gainda', 'गेंडा', 'Phenyl', 'फिनाईल', [('1L', 90)]),
    ('Scotch-Brite', 'स्कॉच ब्राईट', 'Scrub Pad', 'स्क्रब पॅड', [('1pc', 20), ('3pc', 55)]),
    ('', '', 'Steel Scrubber', 'स्टील घासणी', [('1pc', 10)]),
    ('', '', 'Broom (Jhadu)', 'झाडू', [('1pc', 120)]),
    ('', '', 'Floor Wiper', 'वायपर', [('1pc', 150)]),
    ('Good Knight', 'गुड नाईट', 'Gold Flash Refill', 'गोल्ड फ्लॅश रिफिल', [('45ml', 85)]),
    ('Good Knight', 'गुड नाईट', 'Machine + Refill', 'मशीन + रिफिल', [('1pk', 110)]),
    ('All Out', 'ऑल आऊट', 'Ultra Refill', 'अल्ट्रा रिफिल', [('45ml', 85)]),
    ('Mortein', 'मॉर्टीन', 'Coil', 'कॉईल', [('10pc', 40)]),
    ('Hit', 'हिट', 'Spray', 'स्प्रे', [('200ml', 199), ('400ml', 320)]),
    ('Odonil', 'ओडोनिल', 'Air Freshener', 'एअर फ्रेशनर', [('50g', 55)]),
    ('Laxman Rekha', 'लक्ष्मण रेखा', 'Chalk', 'खडू', [('1pc', 20)]),
    ('', '', 'Naphthalene Balls', 'डांबर गोळ्या', [('100g', 40)]),
    ('', '', 'Garbage Bags', 'कचरा पिशव्या', [('30pc', 90)]),
    ('', '', 'Matchbox', 'काडेपेटी', [('1pc', 2), ('10pc', 20)]),
    ('', '', 'Candles', 'मेणबत्ती', [('6pc', 30)]),
    ('Eveready', 'एव्हरेडी', 'AA Battery', 'AA बॅटरी', [('2pc', 40)]),
    ('Duracell', 'ड्युरासेल', 'AA Battery', 'AA बॅटरी', [('2pc', 90)]),
    ('Syska', 'सिस्का', 'LED Bulb 9W', 'LED बल्ब 9W', [('1pc', 99)]),
    ('Philips', 'फिलिप्स', 'LED Bulb 9W', 'LED बल्ब 9W', [('1pc', 120)])]:
    add(b_en, b_mr, en, mr, CLEAN, sizes, 'piece')

# ------------------------------------------------------------------ bath soaps
for b_en, b_mr, en, mr, sizes in [
    ('Lifebuoy', 'लाइफबॉय', 'Total Soap', 'टोटल साबण', [('100g', 35), ('4pc', 135)]),
    ('Lux', 'लक्स', 'Soap', 'साबण', [('100g', 40), ('4pc', 150)]),
    ('Dettol', 'डेटॉल', 'Original Soap', 'ओरिजिनल साबण', [('75g', 40), ('125g', 65), ('4pc', 225)]),
    ('Santoor', 'संतूर', 'Sandal Soap', 'चंदन साबण', [('100g', 38), ('4pc', 140)]),
    ('Cinthol', 'सिंथॉल', 'Original Soap', 'ओरिजिनल साबण', [('100g', 40)]),
    ('Hamam', 'हमाम', 'Soap', 'साबण', [('100g', 38)]),
    ('Medimix', 'मेडिमिक्स', 'Ayurvedic Soap', 'आयुर्वेदिक साबण', [('75g', 40), ('125g', 55)]),
    ('Pears', 'पिअर्स', 'Pure & Gentle Soap', 'साबण', [('75g', 50), ('125g', 75)]),
    ('Dove', 'डव्ह', 'Cream Beauty Bar', 'साबण', [('100g', 65)]),
    ('Mysore Sandal', 'म्हैसूर सँडल', 'Soap', 'साबण', [('75g', 55), ('125g', 85)]),
    ('Godrej No.1', 'गोदरेज नं.1', 'Soap', 'साबण', [('100g', 30), ('4pc', 110)]),
    ('Vivel', 'विवेल', 'Soap', 'साबण', [('100g', 40)]),
    ('Patanjali', 'पतंजली', 'Neem Soap', 'कडुनिंब साबण', [('75g', 25)]),
    ('Lifebuoy', 'लाइफबॉय', 'Handwash', 'हँडवॉश', [('185ml', 99)]),
    ('Dettol', 'डेटॉल', 'Handwash', 'हँडवॉश', [('200ml', 99)]),
    ('Dettol', 'डेटॉल', 'Antiseptic Liquid', 'अँटिसेप्टिक लिक्विड', [('60ml', 45), ('125ml', 85), ('250ml', 175), ('550ml', 330)]),
    ('Savlon', 'सॅव्हलॉन', 'Antiseptic Liquid', 'अँटिसेप्टिक लिक्विड', [('100ml', 60), ('500ml', 230)])]:
    add(b_en, b_mr, en, mr, SOAP, sizes, 'piece')

# ------------------------------------------------------------------ hair & skin
for b_en, b_mr, en, mr, sizes in [
    ('Clinic Plus', 'क्लिनिक प्लस', 'Shampoo', 'शॅम्पू', [('6ml', 1), ('175ml', 115), ('340ml', 220)]),
    ('Sunsilk', 'सनसिल्क', 'Shampoo', 'शॅम्पू', [('6ml', 2), ('180ml', 130), ('340ml', 245)]),
    ('Head & Shoulders', 'हेड अँड शोल्डर्स', 'Shampoo', 'शॅम्पू', [('6ml', 2), ('180ml', 180), ('340ml', 340)]),
    ('Pantene', 'पॅन्टीन', 'Shampoo', 'शॅम्पू', [('6ml', 2), ('180ml', 180)]),
    ('Dove', 'डव्ह', 'Shampoo', 'शॅम्पू', [('6ml', 2), ('180ml', 185)]),
    ('Chik', 'चिक', 'Shampoo', 'शॅम्पू', [('6ml', 1)]),
    ('Meera', 'मीरा', 'Shikakai Shampoo', 'शिकेकाई शॅम्पू', [('6ml', 1), ('180ml', 99)]),
    ('Parachute', 'पॅराशूट', 'Advansed Jasmine Oil', 'जास्मिन तेल', [('90ml', 45), ('200ml', 99)]),
    ('Bajaj', 'बजाज', 'Almond Drops Hair Oil', 'आल्मंड ड्रॉप्स तेल', [('100ml', 75), ('200ml', 145)]),
    ('Dabur', 'डाबर', 'Amla Hair Oil', 'आवळा तेल', [('90ml', 55), ('180ml', 105), ('450ml', 245)]),
    ('Navratna', 'नवरत्न', 'Cool Oil', 'थंड तेल', [('100ml', 85), ('200ml', 165)]),
    ('Keo Karpin', 'केओ कार्पिन', 'Hair Oil', 'केसांचे तेल', [('100ml', 85)]),
    ('Nihar', 'निहार', 'Shanti Amla Oil', 'शांती आवळा तेल', [('100ml', 40), ('200ml', 75)]),
    ('Indulekha', 'इंदुलेखा', 'Bringha Oil', 'भृंगा तेल', [('100ml', 432)]),
    ('Godrej', 'गोदरेज', 'Expert Hair Colour', 'हेअर कलर', [('1pk', 40)]),
    ('Glow & Lovely', 'ग्लो अँड लव्हली', 'Cream', 'क्रीम', [('25g', 85), ('50g', 145)]),
    ('Ponds', 'पॉन्ड्स', 'Talc', 'पावडर', [('100g', 99), ('400g', 330)]),
    ('Ponds', 'पॉन्ड्स', 'Cold Cream', 'कोल्ड क्रीम', [('50ml', 99)]),
    ('Boroplus', 'बोरोप्लस', 'Antiseptic Cream', 'अँटिसेप्टिक क्रीम', [('20ml', 50), ('80ml', 145)]),
    ('Boroline', 'बोरोलीन', 'Cream', 'क्रीम', [('20g', 45)]),
    ('Vaseline', 'व्हॅसलिन', 'Petroleum Jelly', 'पेट्रोलियम जेली', [('42ml', 70), ('85ml', 125)]),
    ('Vaseline', 'व्हॅसलिन', 'Body Lotion', 'बॉडी लोशन', [('100ml', 140), ('400ml', 399)]),
    ('Nivea', 'निव्हिया', 'Creme', 'क्रीम', [('60ml', 125)]),
    ('Himalaya', 'हिमालया', 'Neem Face Wash', 'कडुनिंब फेसवॉश', [('50ml', 90), ('150ml', 205)]),
    ('Fogg', 'फॉग', 'Deodorant', 'डिओडरंट', [('150ml', 260)]),
    ('Cuticura', 'क्युटिक्युरा', 'Talc', 'पावडर', [('100g', 90)]),
    ('Gillette', 'जिलेट', 'Guard Razor', 'गार्ड रेझर', [('1pc', 30)]),
    ('Gillette', 'जिलेट', 'Shaving Foam', 'शेव्हिंग फोम', [('200g', 220)]),
    ('Godrej', 'गोदरेज', 'Shaving Cream', 'शेव्हिंग क्रीम', [('70g', 55)]),
    ('7 O\'Clock', '7 ओ क्लॉक', 'Blade', 'ब्लेड', [('5pc', 50)]),
    ('Whisper', 'व्हिस्पर', 'Choice Pads', 'चॉइस पॅड्स', [('7pc', 40), ('20pc', 99)]),
    ('Stayfree', 'स्टेफ्री', 'Secure Pads', 'सिक्युअर पॅड्स', [('7pc', 40), ('20pc', 99)]),
    ('', '', 'Coconut Oil Tin', 'खोबरेल तेल डबा', [('1L', 320)]),
    ('', '', 'Kajal', 'काजळ', [('1pc', 99)]),
    ('', '', 'Comb', 'कंगवा', [('1pc', 20)])]:
    add(b_en, b_mr, en, mr, HAIR, sizes, 'piece')

# ------------------------------------------------------------------ teeth
for b_en, b_mr, en, mr, sizes in [
    ('Colgate', 'कोलगेट', 'Strong Teeth Toothpaste', 'टूथपेस्ट', [('50g', 30), ('100g', 60), ('200g', 115)]),
    ('Colgate', 'कोलगेट', 'MaxFresh Toothpaste', 'मॅक्सफ्रेश टूथपेस्ट', [('80g', 65), ('150g', 120)]),
    ('Colgate', 'कोलगेट', 'Toothbrush', 'टूथब्रश', [('1pc', 30), ('4pc', 99)]),
    ('Colgate', 'कोलगेट', 'Tooth Powder', 'दंतमंजन', [('100g', 40), ('200g', 75)]),
    ('Pepsodent', 'पेप्सोडेंट', 'Toothpaste', 'टूथपेस्ट', [('80g', 45), ('150g', 90)]),
    ('Close Up', 'क्लोज अप', 'Toothpaste', 'टूथपेस्ट', [('80g', 60), ('150g', 105)]),
    ('Dabur Red', 'डाबर रेड', 'Toothpaste', 'टूथपेस्ट', [('100g', 65), ('200g', 125)]),
    ('Dabur', 'डाबर', 'Red Tooth Powder', 'लाल दंतमंजन', [('60g', 35)]),
    ('Patanjali', 'पतंजली', 'Dant Kanti', 'दंत कांती', [('100g', 55), ('200g', 106)]),
    ('Sensodyne', 'सेन्सोडाइन', 'Toothpaste', 'टूथपेस्ट', [('70g', 130)]),
    ('Vicco', 'विको', 'Vajradanti', 'वज्रदंती', [('100g', 105)]),
    ('Babool', 'बबूल', 'Toothpaste', 'टूथपेस्ट', [('80g', 40)]),
    ('Oral-B', 'ओरल-बी', 'Toothbrush', 'टूथब्रश', [('1pc', 35)])]:
    add(b_en, b_mr, en, mr, TEETH, sizes, 'piece')

# ------------------------------------------------------------------ pooja
for b_en, b_mr, en, mr, sizes in [
    ('Cycle', 'सायकल', 'Agarbatti', 'अगरबत्ती', [('1pk', 50)]), ('Mangaldeep', 'मंगलदीप', 'Agarbatti', 'अगरबत्ती', [('1pk', 50)]),
    ('Zed Black', 'झेड ब्लॅक', 'Agarbatti', 'अगरबत्ती', [('1pk', 50)]), ('Moksh', 'मोक्ष', 'Agarbatti', 'अगरबत्ती', [('1pk', 30)]),
    ('Mangaldeep', 'मंगलदीप', 'Dhoop', 'धूप', [('1pk', 40)]), ('', '', 'Camphor (Kapur)', 'कापूर', [('20g', 40), ('50g', 95)]),
    ('', '', 'Kumkum', 'कुंकू', [('1pk', 10)]), ('', '', 'Haldi Kumkum', 'हळदी कुंकू', [('1pk', 20)]),
    ('', '', 'Gulal', 'गुलाल', [('100g', 20)]), ('', '', 'Ashtagandha', 'अष्टगंध', [('1pk', 20)]),
    ('', '', 'Cotton Wicks (Vati)', 'वाती', [('1pk', 10)]), ('', '', 'Diya Oil', 'दिव्याचे तेल', [('500ml', 70)]),
    ('', '', 'Supari', 'सुपारी', [('100g', 60)]), ('', '', 'Coconut', 'नारळ (पूजा)', [('1pc', 30)]),
    ('', '', 'Panchamrut Kit', 'पंचामृत किट', [('1pk', 50)]), ('', '', 'Akshata Rice', 'अक्षता', [('100g', 10)])]:
    add(b_en, b_mr, en, mr, POOJA, sizes, 'piece')

# ------------------------------------------------------------------ health (OTC)
for b_en, b_mr, en, mr, sizes in [
    ('Eno', 'इनो', 'Fruit Salt', 'फ्रूट सॉल्ट', [('5g', 10), ('100g', 165)]), ('Hajmola', 'हाजमोला', 'Tablets', 'गोळ्या', [('1pk', 10), ('120pc', 75)]),
    ('Vicks', 'व्हिक्स', 'VapoRub', 'व्हेपोरब', [('10g', 50), ('25g', 110)]), ('Vicks', 'व्हिक्स', 'Action 500', 'ॲक्शन 500', [('10pc', 45)]),
    ('Iodex', 'आयोडेक्स', 'Balm', 'बाम', [('16g', 60)]), ('Moov', 'मूव', 'Cream', 'क्रीम', [('15g', 85)]),
    ('Zandu', 'झंडू', 'Balm', 'बाम', [('8ml', 45)]), ('Amrutanjan', 'अमृतांजन', 'Balm', 'बाम', [('8ml', 40)]),
    ('Band-Aid', 'बँड-एड', 'Strips', 'पट्ट्या', [('10pc', 25)]), ('Dettol', 'डेटॉल', 'Plaster', 'प्लास्टर', [('10pc', 30)]),
    ('Dabur', 'डाबर', 'Chyawanprash', 'च्यवनप्राश', [('500g', 245), ('1kg', 420)]), ('Dabur', 'डाबर', 'Pudin Hara', 'पुदिन हरा', [('10pc', 30)]),
    ('Halls', 'हॉल्स', 'Lozenges', 'गोळ्या', [('1pk', 10)]), ('Strepsils', 'स्ट्रेप्सिल्स', 'Lozenges', 'गोळ्या', [('8pc', 45)]),
    ('Dettol', 'डेटॉल', 'Hand Sanitizer', 'हँड सॅनिटायझर', [('50ml', 30), ('200ml', 99)]), ('', '', 'Cotton Roll', 'कापूस', [('100g', 60)])]:
    add(b_en, b_mr, en, mr, HEALTH, sizes, 'piece')

# ------------------------------------------------------------------ baby
for b_en, b_mr, en, mr, sizes in [
    ('Pampers', 'पॅम्पर्स', 'Diaper Pants M', 'डायपर पँट्स M', [('5pc', 99), ('38pc', 699)]),
    ('MamyPoko', 'मॅमीपोको', 'Pants M', 'पँट्स M', [('5pc', 99), ('38pc', 649)]),
    ('Huggies', 'हगीज', 'Wonder Pants M', 'वंडर पँट्स M', [('5pc', 99)]),
    ('Johnson\'s', 'जॉन्सन्स', 'Baby Powder', 'बेबी पावडर', [('100g', 120), ('200g', 225)]),
    ('Johnson\'s', 'जॉन्सन्स', 'Baby Soap', 'बेबी साबण', [('75g', 60)]),
    ('Johnson\'s', 'जॉन्सन्स', 'Baby Oil', 'बेबी ऑईल', [('100ml', 175)]),
    ('Himalaya', 'हिमालया', 'Baby Lotion', 'बेबी लोशन', [('100ml', 140)]),
    ('Nestle', 'नेस्ले', 'Cerelac Wheat', 'सेरेलॅक गहू', [('300g', 280)]),
    ('Nestle', 'नेस्ले', 'Lactogen 1', 'लॅक्टोजेन 1', [('400g', 450)])]:
    add(b_en, b_mr, en, mr, BABY, sizes, 'piece')

# ------------------------------------------------------------------ other daily items
for b_en, b_mr, en, mr, sizes in [
    ('', '', 'Pan Masala Rajnigandha', 'रजनीगंधा पान मसाला', [('1pk', 10)]),
    ('', '', 'Plastic Carry Bag', 'कॅरी बॅग', [('1pc', 2)]),
    ('', '', 'Aluminium Foil', 'ॲल्युमिनियम फॉईल', [('1pc', 99)]),
    ('', '', 'Paper Plates', 'कागदी प्लेट', [('25pc', 40)]),
    ('', '', 'Paper Cups', 'कागदी कप', [('50pc', 50)]),
    ('', '', 'Tissue Paper', 'टिश्यू पेपर', [('100pc', 50)]),
    ('Classmate', 'क्लासमेट', 'Notebook', 'वही', [('1pc', 50)]),
    ('Reynolds', 'रेनॉल्ड्स', 'Pen', 'पेन', [('1pc', 10)]),
    ('Fevicol', 'फेविकॉल', 'MR', 'एमआर', [('1pc', 10)]),
    ('Fevikwik', 'फेविक्विक', 'Tube', 'ट्यूब', [('1pc', 10)]),
    ('Kiwi', 'किवी', 'Shoe Polish', 'बूट पॉलिश', [('40g', 60)]),
    ('', '', 'Rubber Band', 'रबर बँड', [('100g', 30)]),
    ('', '', 'Agarbatti Stand', 'अगरबत्ती स्टँड', [('1pc', 20)]),
    ('Pedigree', 'पेडिग्री', 'Dog Food', 'कुत्र्याचे अन्न', [('400g', 150), ('1.2kg', 400)])]:
    add(b_en, b_mr, en, mr, OTHER, sizes, 'piece')

out = os.path.join(os.path.dirname(__file__), '..', 'public', 'catalog', 'v1.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    json.dump({'version': 1, 'note': 'Approximate suggested retail prices for guidance; the shop owner confirms every price.',
               'fields': ['ref', 'name_mr', 'name_en', 'category', 'unit', 'price_paise', 'brand'], 'items': ITEMS},
              f, ensure_ascii=False, separators=(',', ':'))
print(len(ITEMS), 'items,', os.path.getsize(out), 'bytes')
