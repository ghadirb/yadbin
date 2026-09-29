package com.yadbin.teacher

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import com.yadbin.teacher.ui.AppNav
import com.yadbin.teacher.ui.common.LocalContainer
import com.yadbin.teacher.ui.theme.YadbinTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as YadbinApp).container
        setContent {
            CompositionLocalProvider(LocalContainer provides container) {
                YadbinTheme {
                    Surface { AppNav() }
                }
            }
        }
    }
}
