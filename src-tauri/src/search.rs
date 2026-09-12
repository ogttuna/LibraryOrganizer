use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

/// A derived search representation only. Never use for taxonomy identity.
pub fn normalize(text: &str) -> String {
    text.replace(['İ', 'I', 'ı'], "i")
        .to_lowercase()
        .nfd()
        .filter(|c| !is_combining_mark(*c))
        .collect()
}

pub fn fts_query(text: &str) -> Option<String> {
    let folded = normalize(text);
    let terms: Vec<_> = folded
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .take(32)
        .map(|word| format!("\"{word}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" AND "))
}

/// Turkish alphabet order, independent of the host OS and search accent folding.
pub fn compare_turkish(left: &str, right: &str) -> std::cmp::Ordering {
    fn weights(text: &str) -> impl Iterator<Item = u32> + '_ {
        text.nfc()
            .flat_map(|c| match c {
                'I' => 'ı'.to_lowercase(),
                'İ' => 'i'.to_lowercase(),
                _ => c.to_lowercase(),
            })
            .map(|c| {
                "abcçdefgğhıijklmnoöpqrsştuüvwxyz"
                    .chars()
                    .position(|letter| letter == c)
                    .map_or(c as u32, |index| 128 + index as u32)
            })
    }
    weights(left).cmp(weights(right))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn turkish_and_query_operators_are_plain_text() {
        assert_eq!(
            normalize("Öğrenme IŞIK İstanbul ıiİI çŞÜ"),
            "ogrenme isik istanbul iiii csu"
        );
        assert_eq!(
            fts_query("notlar:örneklem OR \"*"),
            Some("\"notlar\"* AND \"orneklem\"* AND \"or\"*".into())
        );
        assert_eq!(fts_query("\" ** ()"), None);
    }
    #[test]
    fn title_order_keeps_turkish_letters_distinct() {
        let mut titles = [
            "Üzüm",
            "İstanbul",
            "Çınar",
            "Güneş",
            "Işık",
            "Öğrenme",
            "Şiir",
            "Umut",
            "Çağ",
            "Ceviz",
        ];
        titles.sort_by(|a, b| compare_turkish(a, b));
        assert_eq!(
            titles,
            [
                "Ceviz",
                "Çağ",
                "Çınar",
                "Güneş",
                "Işık",
                "İstanbul",
                "Öğrenme",
                "Şiir",
                "Umut",
                "Üzüm"
            ]
        );
        assert_eq!(
            compare_turkish("İSTANBUL", "istanbul"),
            std::cmp::Ordering::Equal
        );
    }
}
