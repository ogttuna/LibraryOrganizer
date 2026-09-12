use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Validation(String),
    #[error("Kayıt bulunamadı.")]
    NotFound,
    #[error("Veritabanı işlemi tamamlanamadı: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Dosya işlemi tamamlanamadı: {0}")]
    Io(#[from] std::io::Error),
    #[error("Veri okunamadı: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Şema hazırlanamadı: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("Yedek arşivi işlenemedi: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Arka plan işlemi tamamlanamadı: {0}")]
    Task(#[from] tokio::task::JoinError),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub fn validate_text(value: &str, name: &str, max: usize, required: bool) -> Result<()> {
    if (required && value.trim().is_empty()) || value.chars().count() > max || value.contains('\0')
    {
        return Err(Error::Validation(format!(
            "{name} geçersiz. En fazla {max} karakter kullanın."
        )));
    }
    Ok(())
}
