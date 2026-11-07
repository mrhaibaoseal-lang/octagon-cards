"""PixelLab 256 文字提示詞產生器：每位選手的外觀特徵 -> 統一格式提示詞（只有文字，不含圖）。
用法：python pipeline/pl_fighters.py <id>   或不給 id 列出全部。
特徵依官方全身照人工填寫；短褲一律純色、手套純黑、不畫字（見 docs/ART_SPEC.md）。"""
import sys

T = ("Pixel art fighting game character of {name}, full body, side view facing right, an MMA fighter. "
     "Realistic adult proportions, about 8 heads tall, small head, NOT chibi. {look}. Shirtless. {tattoo} "
     "Plain solid {shorts} fight shorts with a plain solid black waistband, no logos and no trim, "
     "plain solid black open-finger MMA gloves with no markings, barefoot. Orthodox fighting stance, "
     "both fists raised near the chin, knees slightly bent. 16-bit fighting game style, strong dark outline, no text, no logos.")

F = {
 "aspinall": ("Tom Aspinall", "Tall broad heavyweight, muscular with a slight belly, fair skin, short dark brown hair faded on the sides and longer swept up on top, thin dark goatee and mustache",
   "Tattoos in dark grey ink: the whole near arm covered shoulder to wrist, the whole chest covered, tattoos on the other forearm and ankle.", "light grey"),
 "makhachev": ("Islam Makhachev", "Stocky muscular lightweight, olive skin, short dark hair faded on the sides, full short trimmed black beard",
   "No tattoos.", "white"),
 "jones": ("Jon Jones", "Very tall rangy heavyweight with long arms, broad shoulders and a slight belly, dark brown skin, short cropped black hair, light stubble",
   "A small dark tattoo on the upper chest.", "dark grey"),
 "chimaev": ("Khamzat Chimaev", "Medium-height muscular build, olive skin, short black hair, thick full black beard, hairy chest",
   "No tattoos.", "white"),
 "rakhmonov": ("Shavkat Rakhmonov", "Lean tall athletic welterweight with Central Asian features, tan skin, short black hair, clean shaven",
   "No tattoos.", "black"),
 "umar": ("Umar Nurmagomedov", "Lean ripped bantamweight, olive skin, short dark hair, short trimmed dark beard",
   "No tattoos.", "white"),
 "tsarukyan": ("Arman Tsarukyan", "Short stocky muscular lightweight, olive skin, dark brown hair swept up on top with short sides, full black beard",
   "No tattoos.", "dark navy"),
 "topuria": ("Ilia Topuria", "Muscular lightweight, tan skin, short dark hair with faded sides, short dark trimmed beard",
   "Tattoos in dark grey ink: the whole chest covered with a large tiger and floral design, the near arm covered in a sleeve.", "red"),
 "yan": ("Petr Yan", "Compact muscular bantamweight, fair skin, short cropped light brown hair, light stubble",
   "No tattoos.", "dark navy"),
 "gane": ("Ciryl Gane", "Tall lean muscular heavyweight, dark brown skin, very short shaved hair, short trimmed goatee",
   "A small tattoo on the upper chest.", "royal blue"),
 "ankalaev": ("Magomed Ankalaev", "Lean muscular light heavyweight, fair skin, thick dark brown hair swept back, medium-length ginger-brown beard, hairy chest",
   "No tattoos.", "red"),
 "gaethje": ("Justin Gaethje", "Lean muscular lightweight, tanned fair skin, short auburn hair, ginger stubble",
   "No tattoos.", "white"),
 "volkanovski": ("Alexander Volkanovski", "Short stocky muscular featherweight, fair skin, completely bald head, short trimmed grey-brown beard",
   "Tattoos in dark grey ink: the near arm covered in a full sleeve.", "dark green"),
 "holloway": ("Max Holloway", "Lean muscular Hawaiian lightweight, tan skin, short black hair with shaved sides, clean shaven",
   "Tattoos in dark grey ink: the whole chest covered, both arms covered in full sleeves from shoulder to wrist.", "white"),
 "duplessis": ("Dricus Du Plessis", "Muscular middleweight, tan skin, short dark brown hair swept up, short stubble beard",
   "No tattoos.", "dark green"),
 "lopes": ("Diego Lopes", "Muscular lightweight, tan skin, dark brown hair slicked back with faded sides, thick mustache and light stubble",
   "Tattoos in dark grey ink: script lines across the upper chest, small tattoos on both arms and the ribs.", "white"),
 "garry": ("Ian Machado Garry", "Tall lean welterweight, very pale skin, very short blond hair, clean shaven",
   "Tattoos in dark grey ink: two small tattoos on the upper chest and a band around the ankle.", "indigo blue"),
 "strickland": ("Sean Strickland", "Tall wiry middleweight, fair skin, shaved head, short stubble, very hairy chest and belly",
   "No tattoos.", "black"),
 "pantoja": ("Alexandre Pantoja", "Compact muscular flyweight, tan Brazilian, buzzed short dark hair, short greying beard",
   "Tattoos in dark grey ink: the whole near arm and shoulder covered, the other forearm tattooed.", "dark red"),
 "pereira": ("Alex Pereira", "Tall muscular light heavyweight, tan skin, very short buzzed dark hair, light stubble",
   "Tattoos in dark grey ink and red: the whole chest and belly covered, both arms covered in full sleeves from shoulder to wrist.", "yellow"),
 "belal": ("Belal Muhammad", "Medium-height muscular welterweight, olive skin, short dark hair, long thick full black beard, hairy chest",
   "No tattoos.", "dark green"),
 "prochazka": ("Jiri Prochazka", "Lean wiry light heavyweight, fair skin, short brown hair, medium-length brown beard",
   "Small star tattoos on the chest.", "red"),
 "whittaker": ("Robert Whittaker", "Lean muscular middleweight, light tan skin, short black hair with buzzed sides, black goatee",
   "Tattoos in dark grey ink: a large tribal design covering the near shoulder and upper arm, small star tattoos on the chest.", "dark navy"),
 "poirier": ("Dustin Poirier", "Muscular lightweight, tan skin, very short light brown hair, light stubble",
   "Tattoos in dark grey ink: both arms covered in full sleeves from shoulder to wrist, script across the upper chest, the near pectoral covered.", "dark teal"),
 "adesanya": ("Israel Adesanya", "Tall slender lean middleweight, dark brown skin, short black hair with faded sides, clean shaven",
   "Tattoos in dark grey ink: lines of script across the upper chest and shoulders, small tattoos on the arms.", "dark navy"),
 "jdm": ("Jack Della Maddalena", "Lean muscular welterweight, fair skin, short red-brown hair, short ginger stubble",
   "No tattoos.", "dark green"),
 "chandler": ("Michael Chandler", "Very muscular defined lightweight, tan skin, dark brown hair swept back, short dark stubble",
   "A small script tattoo on the upper chest.", "red"),
 "gsp": ("Georges St-Pierre", "Lean muscular veteran welterweight, tan skin, short dark brown hair, light stubble",
   "A small dark tattoo on the upper chest.", "light grey"),
 "silva": ("Anderson Silva", "Tall slender lean veteran middleweight, dark brown skin, shaved head, clean shaven",
   "No tattoos.", "yellow"),
 "omalley": ("Sean O'Malley", "Tall very lean slim bantamweight, pale skin, narrow face with a thin goatee, medium-length curly shaggy mop of bright magenta pink hair with blue dyed curls at the back",
   "Tattoos in dark grey ink: a large pair of feathered wings across the whole chest, the whole far arm covered in a sleeve, tattoos on the near forearm and ribs.", "white"),
}

def prompt(i):
    n, look, tat, sh = F[i]
    return T.format(name=n, look=look, tattoo=tat, shorts=sh)

if __name__ == "__main__":
    for i in (sys.argv[1:] or F):
        print(i, "->", prompt(i) if sys.argv[1:] else F[i][0])
