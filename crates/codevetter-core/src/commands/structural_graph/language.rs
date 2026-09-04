use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum SupportedLanguage {
    TypeScript,
    Tsx,
    JavaScript,
    Jsx,
    Rust,
    Python,
    Go,
    Java,
    C,
    Cpp,
    CSharp,
    Ruby,
    Php,
    Kotlin,
    Swift,
}

impl SupportedLanguage {
    pub const ALL: [Self; 15] = [
        Self::TypeScript,
        Self::Tsx,
        Self::JavaScript,
        Self::Jsx,
        Self::Rust,
        Self::Python,
        Self::Go,
        Self::Java,
        Self::C,
        Self::Cpp,
        Self::CSharp,
        Self::Ruby,
        Self::Php,
        Self::Kotlin,
        Self::Swift,
    ];

    pub fn from_path(path: &Path) -> Option<Self> {
        let file_name = path.file_name()?.to_str()?.to_ascii_lowercase();
        let extension = path.extension()?.to_str()?.to_ascii_lowercase();
        match extension.as_str() {
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            "tsx" => Some(Self::Tsx),
            "js" | "mjs" | "cjs" => Some(Self::JavaScript),
            "jsx" => Some(Self::Jsx),
            "rs" => Some(Self::Rust),
            "py" | "pyi" => Some(Self::Python),
            "go" => Some(Self::Go),
            "java" => Some(Self::Java),
            "c" | "h" if !file_name.ends_with(".cs") => Some(Self::C),
            "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => Some(Self::Cpp),
            "cs" => Some(Self::CSharp),
            "rb" | "rake" => Some(Self::Ruby),
            "php" | "php3" | "php4" | "php5" | "phtml" => Some(Self::Php),
            "kt" | "kts" => Some(Self::Kotlin),
            "swift" => Some(Self::Swift),
            _ if file_name == "rakefile" || file_name == "gemfile" => Some(Self::Ruby),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Tsx => "tsx",
            Self::JavaScript => "javascript",
            Self::Jsx => "jsx",
            Self::Rust => "rust",
            Self::Python => "python",
            Self::Go => "go",
            Self::Java => "java",
            Self::C => "c",
            Self::Cpp => "cpp",
            Self::CSharp => "csharp",
            Self::Ruby => "ruby",
            Self::Php => "php",
            Self::Kotlin => "kotlin",
            Self::Swift => "swift",
        }
    }

    pub fn tree_sitter_language(self) -> tree_sitter::Language {
        match self {
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::JavaScript | Self::Jsx => tree_sitter_javascript::LANGUAGE.into(),
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::Python => tree_sitter_python::LANGUAGE.into(),
            Self::Go => tree_sitter_go::LANGUAGE.into(),
            Self::Java => tree_sitter_java::LANGUAGE.into(),
            Self::C => tree_sitter_c::LANGUAGE.into(),
            Self::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            Self::CSharp => tree_sitter_c_sharp::LANGUAGE.into(),
            Self::Ruby => tree_sitter_ruby::LANGUAGE.into(),
            Self::Php => tree_sitter_php::LANGUAGE_PHP.into(),
            Self::Kotlin => tree_sitter_kotlin::LANGUAGE.into(),
            Self::Swift => tree_sitter_swift::LANGUAGE.into(),
        }
    }
}

pub fn supported_language_names() -> Vec<String> {
    let mut names = SupportedLanguage::ALL
        .iter()
        .map(|language| language.name().to_string())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promised_language_matrix_is_path_detectable() {
        for (path, expected) in [
            ("app.ts", "typescript"),
            ("view.tsx", "tsx"),
            ("app.js", "javascript"),
            ("view.jsx", "jsx"),
            ("lib.rs", "rust"),
            ("app.py", "python"),
            ("main.go", "go"),
            ("Main.java", "java"),
            ("main.c", "c"),
            ("main.cpp", "cpp"),
            ("Main.cs", "csharp"),
            ("app.rb", "ruby"),
            ("index.php", "php"),
            ("Main.kt", "kotlin"),
            ("Main.swift", "swift"),
        ] {
            assert_eq!(
                SupportedLanguage::from_path(Path::new(path)).map(SupportedLanguage::name),
                Some(expected),
                "{path}"
            );
        }
    }
}
