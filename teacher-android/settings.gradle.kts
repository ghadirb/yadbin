pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Myket in-app billing client (docs: «جاوا (Java)»). Restricted to that one group so no other artifact can come from JitPack.
        maven("https://jitpack.io") { content { includeGroup("com.github.myketstore") } }
    }
}
rootProject.name = "yadbin-teacher"
include(":app")
